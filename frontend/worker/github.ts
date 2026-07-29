import { first, mapCommunityItem, run, type WorkerEnv } from "./db";
import { HttpError } from "./http";

const DOMAIN_RULES: Array<{ domain: string; terms: string[] }> = [
  {
    domain: "FusedMoE",
    terms: ["fused_moe", "fusedmoe", "moe", "expert parallel", "all-to-all", "grouped matmul"],
  },
  {
    domain: "Model Runner",
    terms: ["model runner", "model_runner", "inputbatch", "input_batch", "aclgraph", "graph capture"],
  },
  {
    domain: "Scheduler",
    terms: ["scheduler", "preemption", "kv cache manager", "block table", "spec decode"],
  },
  {
    domain: "Attention",
    terms: ["attention", "mla", "prefix cache", "flash attention", "paged kv"],
  },
  {
    domain: "Distributed",
    terms: ["distributed", "collective rpc", "multiproc", "hccl", "tensor parallel", "multi-node"],
  },
  {
    domain: "CI / Infra",
    terms: [".github/workflows", "buildkit", "cache", "ci", "docker", "runner"],
  },
];

function githubHeaders(env: WorkerEnv, accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    accept,
    "user-agent": "LoongBoard/1.0",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function githubFetch<T>(
  env: WorkerEnv,
  path: string,
  accept?: string,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(env, accept),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new HttpError(502, `GitHub API 调用失败（${response.status}）`, detail);
  }
  if (accept?.includes("diff")) return (await response.text()) as T;
  return response.json<T>();
}

export function detectDomain(text: string) {
  const source = text.toLowerCase();
  let best = { domain: "Other", score: 0 };
  for (const rule of DOMAIN_RULES) {
    const score = rule.terms.reduce(
      (total, term) => total + (source.includes(term) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { domain: rule.domain, score };
  }
  return best.domain;
}

function fallbackSummary(title: string, body: string, domain: string) {
  const firstParagraph = body
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/[#>*_`-]/g, " ").replace(/\s+/g, " ").trim())
    .find((part) => part.length > 30);
  return (
    firstParagraph?.slice(0, 180) ||
    `${domain === "Other" ? "社区" : domain} 相关变化：${title}`.slice(0, 180)
  );
}

function itemId(repoId: string, kind: string, number: number) {
  return `${repoId}:${kind}:${number}`;
}

async function upsertCommunityItem(
  env: WorkerEnv,
  repoId: string,
  kind: "pr" | "issue",
  item: any,
) {
  const title = item.title ?? "";
  const body = item.body ?? "";
  const domain = detectDomain(`${title}\n${body}`);
  const state =
    kind === "pr" && item.merged_at
      ? "merged"
      : kind === "pr" && item.draft
        ? "draft"
        : item.state;
  const statusText =
    state === "merged"
      ? "Merged"
      : state === "draft"
        ? "Draft"
        : state === "closed"
          ? "Closed"
          : kind === "pr"
            ? "Review required"
            : "Open";
  const important =
    /regression|rfc|breaking|security|critical|ascend|cann|moe|mrv2/i.test(
      `${title}\n${body}`,
    ) ? 1 : 0;
  const id = itemId(repoId, kind, item.number);

  await run(
    env,
    `INSERT INTO community_items (
      id, repo_id, kind, number, state, title, author, author_avatar, body_md,
      html_url, comments, domain, ai_summary, status_text, important, updated_at,
      merged_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state = excluded.state,
      title = excluded.title,
      author = excluded.author,
      author_avatar = excluded.author_avatar,
      body_md = excluded.body_md,
      html_url = excluded.html_url,
      comments = excluded.comments,
      domain = CASE WHEN community_items.domain = 'Other'
        THEN excluded.domain ELSE community_items.domain END,
      ai_summary = CASE WHEN community_items.ai_summary = ''
        THEN excluded.ai_summary ELSE community_items.ai_summary END,
      status_text = excluded.status_text,
      important = excluded.important,
      updated_at = excluded.updated_at,
      merged_at = excluded.merged_at,
      fetched_at = excluded.fetched_at`,
    [
      id,
      repoId,
      kind,
      item.number,
      state,
      title,
      item.user?.login ?? "unknown",
      item.user?.avatar_url ?? null,
      body,
      item.html_url ?? null,
      Number(item.comments ?? 0),
      domain,
      fallbackSummary(title, body, domain),
      statusText,
      important,
      item.updated_at ?? new Date().toISOString(),
      item.merged_at ?? null,
      new Date().toISOString(),
    ],
  );
}

export async function syncRepository(env: WorkerEnv, repoId: string) {
  const repository = await first<Record<string, any>>(
    env,
    "SELECT * FROM repositories WHERE id = ?",
    [repoId],
  );
  if (!repository) throw new HttpError(404, "仓库不存在");

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await run(
    env,
    "INSERT INTO sync_runs(id, repo_id, status, started_at) VALUES(?, ?, 'running', ?)",
    [runId, repoId, startedAt],
  );
  await run(env, "UPDATE repositories SET sync_status = 'syncing' WHERE id = ?", [
    repoId,
  ]);

  try {
    const base = `/repos/${repository.owner}/${repository.name}`;
    const [pulls, issues] = await Promise.all([
      githubFetch<any[]>(
        env,
        `${base}/pulls?state=all&sort=updated&direction=desc&per_page=30`,
      ),
      githubFetch<any[]>(
        env,
        `${base}/issues?state=all&sort=updated&direction=desc&per_page=30`,
      ),
    ]);
    const realIssues = issues.filter((issue) => !issue.pull_request);

    for (const pull of pulls) await upsertCommunityItem(env, repoId, "pr", pull);
    for (const issue of realIssues) {
      await upsertCommunityItem(env, repoId, "issue", issue);
    }

    let openPullCount = pulls.filter((pull) => pull.state === "open").length;
    let openIssueCount = realIssues.filter((issue) => issue.state === "open").length;
    try {
      const searchQuery = encodeURIComponent(
        `repo:${repository.owner}/${repository.name} is:open is:pr`,
      );
      const [repoMeta, openPulls] = await Promise.all([
        githubFetch<any>(env, base),
        githubFetch<{ total_count: number }>(
          env,
          `/search/issues?q=${searchQuery}&per_page=1`,
        ),
      ]);
      openPullCount = Number(openPulls.total_count ?? openPullCount);
      openIssueCount = Math.max(
        0,
        Number(repoMeta.open_issues_count ?? openIssueCount) - openPullCount,
      );
    } catch {
      // The search endpoint has a stricter unauthenticated rate limit. The
      // synchronized first page remains a useful lower bound until the next run.
    }

    const finishedAt = new Date().toISOString();
    await run(
      env,
      `UPDATE repositories SET
        open_pull_count = ?, open_issue_count = ?, last_synced_at = ?,
        sync_status = 'ready'
      WHERE id = ?`,
      [
        openPullCount,
        openIssueCount,
        finishedAt,
        repoId,
      ],
    );
    await run(
      env,
      `UPDATE sync_runs SET status = 'ready', item_count = ?, finished_at = ?
       WHERE id = ?`,
      [pulls.length + realIssues.length, finishedAt, runId],
    );
    return {
      id: runId,
      repository: repoId,
      pulls: pulls.length,
      issues: realIssues.length,
      finishedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知同步错误";
    const finishedAt = new Date().toISOString();
    await run(
      env,
      "UPDATE repositories SET sync_status = 'failed' WHERE id = ?",
      [repoId],
    );
    await run(
      env,
      `UPDATE sync_runs SET status = 'failed', error = ?, finished_at = ?
       WHERE id = ?`,
      [message.slice(0, 500), finishedAt, runId],
    );
    throw error;
  }
}

export function parseUnifiedDiff(rawDiff: string) {
  const entries: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch: string;
  }> = [];
  const chunks = rawDiff.split(/(?=^diff --git )/m).filter(Boolean);

  for (const chunk of chunks) {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = header?.[2] ?? header?.[1] ?? "unknown";
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    entries.push({ path, additions, deletions, patch: chunk.trimEnd() });
  }

  return {
    files: entries.length,
    additions: entries.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.deletions, 0),
    entries,
    raw: rawDiff,
    source: "raw-diff",
    complete: true,
  };
}

async function fetchPullFiles(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
) {
  const files: any[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) break;
  }

  const missingPatchCount = files.filter(
    (file) => typeof file.patch !== "string" || !file.patch,
  ).length;
  const entries = files.map((file) => {
    const metadata = [
      `diff --git a/${file.previous_filename ?? file.filename} b/${file.filename}`,
      `status: ${file.status}`,
    ];
    const patch =
      typeof file.patch === "string" && file.patch
        ? `${metadata.join("\n")}\n${file.patch}`
        : `${metadata.join("\n")}\n[GitHub 未返回文本 patch：该文件可能是二进制文件，或其 diff 超出 GitHub API 返回限制。]\nsource: ${file.raw_url ?? file.blob_url ?? "unavailable"}`;
    return {
      path: file.filename,
      additions: Number(file.additions ?? 0),
      deletions: Number(file.deletions ?? 0),
      patch,
    };
  });

  return {
    files: entries.length,
    additions: entries.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.deletions, 0),
    entries,
    raw: entries.map((entry) => entry.patch).join("\n\n"),
    source: "files-api",
    complete: missingPatchCount === 0 && files.length < 3_000,
    notice:
      missingPatchCount > 0
        ? `GitHub raw diff 不可用；已列出全部 ${files.length} 个文件，其中 ${missingPatchCount} 个文件的文本 patch 被 GitHub 限制或属于二进制文件。`
        : "GitHub raw diff 不可用；已通过分页 files API 列出全部文件与可用 patch。",
  };
}

export async function ensurePullDiff(
  env: WorkerEnv,
  repoId: string,
  number: number,
  force = false,
) {
  const row = await first<Record<string, any>>(
    env,
    `SELECT community_items.*, repositories.owner, repositories.name
     FROM community_items
     JOIN repositories ON repositories.id = community_items.repo_id
     WHERE community_items.repo_id = ? AND community_items.kind = 'pr'
       AND community_items.number = ?`,
    [repoId, number],
  );
  if (!row) throw new HttpError(404, "Pull Request 不存在");
  if (row.diff_json && !force) return mapCommunityItem(row);

  let diff;
  try {
    const rawDiff = await githubFetch<string>(
      env,
      `/repos/${row.owner}/${row.name}/pulls/${number}`,
      "application/vnd.github.v3.diff",
    );
    diff = parseUnifiedDiff(rawDiff);
  } catch {
    diff = await fetchPullFiles(env, row.owner, row.name, number);
  }
  const domain = detectDomain(
    `${row.title}\n${row.body_md}\n${diff.entries.map((entry) => entry.path).join("\n")}`,
  );
  await run(
    env,
    `UPDATE community_items SET
      diff_json = ?, diff_files_count = ?, additions = ?, deletions = ?,
      domain = CASE WHEN ? = 'Other' THEN domain ELSE ? END
     WHERE id = ?`,
    [
      JSON.stringify(diff),
      diff.files,
      diff.additions,
      diff.deletions,
      domain,
      domain,
      row.id,
    ],
  );
  return mapCommunityItem({ ...row, diff_json: JSON.stringify(diff), domain });
}

export function diffToText(diff: any) {
  if (!diff) return "无代码变更";
  if (typeof diff.raw === "string") return diff.raw;
  return (diff.entries ?? [])
    .map((entry: any) => `diff -- ${entry.path}\n${entry.patch ?? ""}`)
    .join("\n\n");
}
