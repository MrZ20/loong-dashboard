import { first, mapCommunityItem, parseJson, run, type WorkerEnv } from "./db";
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
  return (await response.json()) as T;
}

async function githubGraphqlFetch<T>(
  env: WorkerEnv,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!env.GITHUB_TOKEN) {
    throw new HttpError(503, "GitHub GraphQL 需要配置访问令牌");
  }
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(env),
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json() as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    const detail =
      payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `GitHub GraphQL 调用失败（${response.status}）`;
    throw new HttpError(502, "GitHub 文件统计获取失败", detail.slice(0, 500));
  }
  return payload.data;
}

async function fetchRecentIssues(
  env: WorkerEnv,
  base: string,
  targetCount = 30,
) {
  const issues: any[] = [];
  const perPage = 100;
  const maxPages = 3;
  for (let page = 1; page <= maxPages && issues.length < targetCount; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `${base}/issues?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
    );
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < perPage) break;
  }
  return issues.slice(0, targetCount);
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
      diff_json = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN NULL ELSE community_items.diff_json END,
      diff_files_count = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN 0 ELSE community_items.diff_files_count END,
      additions = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN 0 ELSE community_items.additions END,
      deletions = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN 0 ELSE community_items.deletions END,
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
    const [pulls, realIssues] = await Promise.all([
      githubFetch<any[]>(
        env,
        `${base}/pulls?state=all&sort=updated&direction=desc&per_page=30`,
      ),
      fetchRecentIssues(env, base),
    ]);

    for (const pull of pulls) await upsertCommunityItem(env, repoId, "pr", pull);
    for (const issue of realIssues) {
      await upsertCommunityItem(env, repoId, "issue", issue);
    }

    // Sidebar counts describe the bounded snapshot this dashboard actually
    // synchronized. Repository-wide GitHub totals can be thousands of items and
    // do not match the recent records available in the local list.
    const syncedPullCount = pulls.length;
    const syncedIssueCount = realIssues.length;

    const finishedAt = new Date().toISOString();
    await run(
      env,
      `UPDATE repositories SET
        open_pull_count = ?, open_issue_count = ?, last_synced_at = ?,
        sync_status = 'ready'
      WHERE id = ?`,
      [
        syncedPullCount,
        syncedIssueCount,
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

async function fetchPullFileStats(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
) {
  if (env.GITHUB_TOKEN) {
    try {
      const entries: Array<{
        path: string;
        additions: number;
        deletions: number;
      }> = [];
      let cursor: string | null = null;
      let files = 0;
      let additions = 0;
      let deletions = 0;
      let hasNextPage = true;
      const query = `
        query PullFileStats(
          $owner: String!
          $name: String!
          $number: Int!
          $cursor: String
        ) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              changedFiles
              additions
              deletions
              files(first: 100, after: $cursor) {
                nodes {
                  path
                  additions
                  deletions
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `;

      while (hasNextPage && entries.length < 3_000) {
        const data = await githubGraphqlFetch<{
          repository?: {
            pullRequest?: {
              changedFiles: number;
              additions: number;
              deletions: number;
              files: {
                nodes: Array<{
                  path: string;
                  additions: number;
                  deletions: number;
                } | null>;
                pageInfo: {
                  hasNextPage: boolean;
                  endCursor: string | null;
                };
              };
            } | null;
          } | null;
        }>(env, query, { owner, name, number, cursor });
        const pull = data.repository?.pullRequest;
        if (!pull) throw new HttpError(404, "Pull Request 不存在");
        files = Number(pull.changedFiles ?? 0);
        additions = Number(pull.additions ?? 0);
        deletions = Number(pull.deletions ?? 0);
        entries.push(
          ...pull.files.nodes
            .filter((file): file is NonNullable<typeof file> => Boolean(file))
            .map((file) => ({
              path: file.path,
              additions: Number(file.additions ?? 0),
              deletions: Number(file.deletions ?? 0),
            })),
        );
        hasNextPage = pull.files.pageInfo.hasNextPage;
        cursor = pull.files.pageInfo.endCursor;
      }

      return {
        files,
        additions,
        deletions,
        entries,
        source: "graphql-files",
        complete: !hasNextPage,
        statsOnly: true,
        notice: "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
      };
    } catch {
      // Public repositories still support a REST fallback. Patch fields returned
      // by GitHub are discarded immediately and are never stored or sent here.
    }
  }

  const entries: Array<{
    path: string;
    additions: number;
    deletions: number;
  }> = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    entries.push(
      ...batch.map((file) => ({
        path: file.filename,
        additions: Number(file.additions ?? 0),
        deletions: Number(file.deletions ?? 0),
      })),
    );
    if (batch.length < 100) break;
  }
  return {
    files: entries.length,
    additions: entries.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.deletions, 0),
    entries,
    source: "files-api-stat",
    complete: entries.length < 3_000,
    statsOnly: true,
    notice: "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
  };
}

export async function ensurePullStats(
  env: WorkerEnv,
  repoId: string,
  number: number,
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
  const storedDiff = parseJson<Record<string, any> | null>(row.diff_json, null);
  if (
    storedDiff &&
    (storedDiff.statsOnly !== true ||
      (Array.isArray(storedDiff.entries) && storedDiff.entries.length > 0) ||
      Number(storedDiff.files ?? 0) === 0)
  ) {
    return mapCommunityItem(row, "stats");
  }

  const diff = await fetchPullFileStats(
    env,
    row.owner,
    row.name,
    number,
  );
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
  return mapCommunityItem(
    { ...row, diff_json: JSON.stringify(diff), domain },
    "stats",
  );
}

async function fetchPullPatches(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
  eligiblePaths: Set<string>,
) {
  const patches = new Map<string, string>();
  try {
    const rawDiff = await githubFetch<string>(
      env,
      `/repos/${owner}/${name}/pulls/${number}`,
      "application/vnd.github.v3.diff",
    );
    for (const entry of parseUnifiedDiff(rawDiff).entries) {
      if (eligiblePaths.has(entry.path)) {
        patches.set(entry.path, entry.patch);
      }
    }
  } catch {
    // Fall through to the paginated files API when GitHub cannot serve raw diff.
  }

  if (patches.size === eligiblePaths.size) return patches;

  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    for (const file of batch) {
      if (
        !eligiblePaths.has(file.filename) ||
        patches.has(file.filename)
      ) {
        continue;
      }
      const metadata = [
        `diff --git a/${file.previous_filename ?? file.filename} b/${file.filename}`,
        `status: ${file.status}`,
      ];
      patches.set(
        file.filename,
        typeof file.patch === "string" && file.patch
          ? `${metadata.join("\n")}\n${file.patch}`
          : `${metadata.join("\n")}\n[GitHub 未返回文本 patch：该文件可能是二进制文件，或其 diff 超出 GitHub API 返回限制。]\nsource: ${file.raw_url ?? file.blob_url ?? "unavailable"}`,
      );
    }
    if (patches.size === eligiblePaths.size) break;
    if (batch.length < 100) break;
  }
  return patches;
}

export async function ensurePullPatches(
  env: WorkerEnv,
  repoId: string,
  number: number,
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

  let storedDiff = parseJson<Record<string, any> | null>(row.diff_json, null);
  if (!Array.isArray(storedDiff?.entries)) {
    const item = await ensurePullStats(env, repoId, number);
    storedDiff = item.diff ?? null;
  }
  const stats = Array.isArray(storedDiff?.entries)
    ? storedDiff.entries.map((entry: Record<string, any>) => ({
        path: String(entry.path ?? ""),
        additions: Number(entry.additions ?? 0),
        deletions: Number(entry.deletions ?? 0),
      }))
    : [];
  const eligibleStats = stats.filter(
    (entry) =>
      entry.path &&
      entry.additions + entry.deletions <= 1_000,
  );
  const skippedLarge = stats.length - eligibleStats.length;
  if (eligibleStats.length === 0) {
    return { entries: [], skippedLarge };
  }

  const patches = await fetchPullPatches(
    env,
    row.owner,
    row.name,
    number,
    new Set(eligibleStats.map((entry) => entry.path)),
  );
  return {
    entries: eligibleStats.flatMap((entry) => {
      const patch = patches.get(entry.path);
      return patch ? [{ ...entry, patch }] : [];
    }),
    skippedLarge,
  };
}

export function diffToText(diff: any) {
  if (!diff) return "代码修改尚未按需获取";
  if (diff.statsOnly) {
    return `${diff.files ?? 0} files changed, ${diff.additions ?? 0} insertions(+), ${diff.deletions ?? 0} deletions(-)`;
  }
  if (typeof diff.raw === "string") return diff.raw;
  return (diff.entries ?? [])
    .map((entry: any) => `diff -- ${entry.path}\n${entry.patch ?? ""}`)
    .join("\n\n");
}
