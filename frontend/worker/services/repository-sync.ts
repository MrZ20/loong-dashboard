import { summarizeCommunityBatch } from "../ai";
import {
  first,
  query,
  run,
  type WorkerEnv,
} from "../db";
import {
  buildReviewSignal,
  classifyDomain,
  fallbackSummary,
} from "../domain/community-intelligence";
import { githubFetch } from "../integrations/github/client";
import {
  fetchPullSyncSnapshots,
  fetchRecentIssues,
  type PullSyncSnapshot,
} from "../integrations/github/pulls";
import { HttpError } from "../http";

function itemId(repoId: string, kind: string, number: number) {
  return `${repoId}:${kind}:${number}`;
}

async function stableHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function recordEvent(
  env: WorkerEnv,
  input: {
    repoId: string;
    itemId: string;
    eventType:
      | "opened"
      | "updated"
      | "draft"
      | "ready_for_review"
      | "merged"
      | "closed"
      | "reopened";
    occurredAt: string;
    source: "github" | "sync";
    actor?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  if (!input.occurredAt) return;
  await run(
    env,
    `INSERT INTO community_events(
      id, repo_id, item_id, event_type, occurred_at, observed_at,
      source, actor, metadata_json
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id, event_type, occurred_at) DO NOTHING`,
    [
      crypto.randomUUID(),
      input.repoId,
      input.itemId,
      input.eventType,
      input.occurredAt,
      new Date().toISOString(),
      input.source,
      input.actor ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function upsertCommunityItem(
  env: WorkerEnv,
  repoId: string,
  kind: "pr" | "issue",
  item: any,
  snapshot?: PullSyncSnapshot,
) {
  const title = item.title ?? "";
  const body = item.body ?? "";
  const domainAssessment = classifyDomain({
    title,
    body,
    files: snapshot?.diff.entries,
  });
  const domain = domainAssessment.domain;
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
  const importanceText = `${title}\n${body}`.replace(
    /\b(?:accuracy\s+)?regression tests?\b/gi,
    "",
  );
  const important =
    /regression|breaking change|security|critical|cve|data loss|performance drop|回归|安全|破坏性/i.test(
      importanceText,
    ) ? 1 : 0;
  const id = itemId(repoId, kind, item.number);
  const now = new Date().toISOString();
  const contentHash = await stableHash(`${title}\n${body}\n${state}`);
  const existing = await first<Record<string, any>>(
    env,
    "SELECT * FROM community_items WHERE id = ?",
    [id],
  );
  const contentChanged = existing?.content_hash !== contentHash;
  const excerpt = fallbackSummary(title, body, domain);

  await run(
    env,
    `INSERT INTO community_items (
      id, repo_id, kind, number, state, title, author, author_avatar, body_md,
      html_url, comments, domain, ai_summary, status_text, important, updated_at,
      created_at, merged_at, closed_at, is_draft, content_hash,
      summary_input_hash, summary_source, summary_updated_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state = excluded.state,
      title = excluded.title,
      author = excluded.author,
      author_avatar = excluded.author_avatar,
      body_md = excluded.body_md,
      html_url = excluded.html_url,
      comments = excluded.comments,
      domain = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.domain
        WHEN community_items.summary_source = 'ai'
          THEN community_items.domain
        ELSE excluded.domain
      END,
      ai_summary = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.ai_summary
        WHEN community_items.summary_source = 'ai'
          THEN community_items.ai_summary
        ELSE excluded.ai_summary
      END,
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
      created_at = COALESCE(excluded.created_at, community_items.created_at),
      updated_at = excluded.updated_at,
      merged_at = excluded.merged_at,
      closed_at = excluded.closed_at,
      is_draft = excluded.is_draft,
      content_hash = excluded.content_hash,
      summary_input_hash = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.summary_input_hash
        ELSE community_items.summary_input_hash
      END,
      summary_source = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN 'excerpt'
        ELSE community_items.summary_source
      END,
      summary_updated_at = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.summary_updated_at
        ELSE community_items.summary_updated_at
      END,
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
      excerpt,
      statusText,
      important,
      item.updated_at ?? new Date().toISOString(),
      item.created_at ?? null,
      item.merged_at ?? null,
      item.closed_at ?? null,
      item.draft ? 1 : 0,
      contentHash,
      contentHash,
      "excerpt",
      now,
      now,
    ],
  );
  const reviewSignal =
    kind === "pr"
      ? buildReviewSignal(
          {
            state,
            draft: Boolean(item.draft),
            comments: Number(item.comments ?? 0),
            source: snapshot ? "github-graphql" : "metadata",
            ...snapshot?.reviewFacts,
          },
          domain,
        )
      : null;
  await run(
    env,
    `UPDATE community_items SET
      domain = ?, domain_source = ?, domain_confidence = ?,
      domain_evidence_json = ?, review_signal_json = ?,
      review_signal_updated_at = ?,
      diff_json = CASE WHEN ? IS NULL THEN diff_json ELSE ? END,
      diff_files_count = CASE WHEN ? IS NULL THEN diff_files_count ELSE ? END,
      additions = CASE WHEN ? IS NULL THEN additions ELSE ? END,
      deletions = CASE WHEN ? IS NULL THEN deletions ELSE ? END
     WHERE id = ?`,
    [
      domain,
      domainAssessment.source,
      domainAssessment.confidence,
      JSON.stringify(domainAssessment),
      reviewSignal ? JSON.stringify(reviewSignal) : "{}",
      reviewSignal?.updatedAt ?? null,
      snapshot ? "available" : null,
      snapshot ? JSON.stringify(snapshot.diff) : null,
      snapshot ? "available" : null,
      snapshot?.diff.files ?? 0,
      snapshot ? "available" : null,
      snapshot?.diff.additions ?? 0,
      snapshot ? "available" : null,
      snapshot?.diff.deletions ?? 0,
      id,
    ],
  );

  const occurredAt = item.updated_at ?? now;
  if (!existing && item.created_at) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "opened",
      occurredAt: item.created_at,
      source: "github",
      actor: item.user?.login,
    });
  }
  if (!existing && state === "draft") {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "draft",
      occurredAt: item.created_at ?? occurredAt,
      source: "sync",
      actor: item.user?.login,
    });
  }
  if (!existing && state === "merged" && item.merged_at) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "merged",
      occurredAt: item.merged_at,
      source: "github",
      actor: item.merged_by?.login,
    });
  } else if (!existing && state === "closed" && item.closed_at) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "closed",
      occurredAt: item.closed_at,
      source: "github",
      actor: item.closed_by?.login,
    });
  }
  if (existing) {
    if (existing.state === "closed" && ["open", "draft"].includes(state)) {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "reopened",
        occurredAt,
        source: "sync",
      });
    }
    if (existing.state !== "merged" && state === "merged") {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "merged",
        occurredAt: item.merged_at ?? occurredAt,
        source: item.merged_at ? "github" : "sync",
      });
    } else if (
      !["closed", "merged"].includes(existing.state) &&
      state === "closed"
    ) {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "closed",
        occurredAt: item.closed_at ?? occurredAt,
        source: item.closed_at ? "github" : "sync",
      });
    }
    if (!existing.is_draft && item.draft) {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "draft",
        occurredAt,
        source: "sync",
      });
    } else if (existing.is_draft && !item.draft && state === "open") {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "ready_for_review",
        occurredAt,
        source: "sync",
      });
    }
  }
  if (!existing || existing.updated_at !== occurredAt || contentChanged) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "updated",
      occurredAt,
      source: "sync",
    });
  }
  return { id, contentHash, contentChanged };
}

async function captureRecentRepositoryEvents(
  env: WorkerEnv,
  repoId: string,
  base: string,
) {
  let events: any[] = [];
  try {
    events = await githubFetch<any[]>(
      env,
      `${base}/issues/events?per_page=100`,
    );
  } catch {
    return 0;
  }
  let captured = 0;
  for (const event of events) {
    if (!["closed", "reopened", "merged"].includes(event.event)) continue;
    const issue = event.issue;
    if (!issue?.number || !event.created_at) continue;
    const kind = issue.pull_request ? "pr" : "issue";
    const row = await first<{ id: string }>(
      env,
      `SELECT id FROM community_items
       WHERE repo_id = ? AND kind = ? AND number = ?`,
      [repoId, kind, issue.number],
    );
    if (!row) continue;
    await recordEvent(env, {
      repoId,
      itemId: row.id,
      eventType: event.event,
      occurredAt: event.created_at,
      source: "github",
      actor: event.actor?.login,
      metadata: { eventId: event.id ?? null },
    });
    captured += 1;
  }
  return captured;
}

async function updatePendingSummaries(
  env: WorkerEnv,
  repoId: string,
  userId: string,
) {
  const rows = await query<Record<string, any>>(
    env,
    `SELECT id, kind, state, title, body_md, content_hash
     FROM community_items
     WHERE repo_id = ? AND summary_source != 'ai'
     ORDER BY updated_at DESC
     LIMIT 30`,
    [repoId],
  );
  if (!rows.length) {
    return { analyzed: 0, provider: "none", providerName: "", warning: "" };
  }
  let analyzed = 0;
  let provider = "fallback";
  let providerName = "";
  for (let index = 0; index < rows.length; index += 10) {
    const batch = rows.slice(index, index + 10);
    const result = await summarizeCommunityBatch(env, {
      userId,
      language: "zh",
      items: batch.map((row) => ({
        id: row.id,
        kind: row.kind,
        state: row.state,
        title: row.title,
        bodyMd: row.body_md,
      })),
    });
    provider = result.provider;
    providerName = result.providerName;
    if (result.provider !== "api") break;
    for (const summary of result.summaries) {
      const source = batch.find((row) => row.id === summary.id);
      if (!source) continue;
      await run(
        env,
        `UPDATE community_items SET
          ai_summary = ?, important = ?,
          summary_source = 'ai', summary_input_hash = ?,
          summary_updated_at = ?
         WHERE id = ? AND content_hash = ?`,
        [
          summary.summary,
          summary.important ? 1 : 0,
          source.content_hash,
          new Date().toISOString(),
          summary.id,
          source.content_hash,
        ],
      );
      analyzed += 1;
    }
  }
  return {
    analyzed,
    provider,
    providerName,
    warning:
      provider === "fallback"
        ? "当前账户未配置可用 AI，列表显示正文摘录。"
        : "",
  };
}

export async function syncRepository(
  env: WorkerEnv,
  repoId: string,
  userId?: string,
) {
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

    let pullSnapshots = new Map<number, PullSyncSnapshot>();
    let reviewSignalWarning = "";
    if (env.GITHUB_TOKEN) {
      try {
        pullSnapshots = await fetchPullSyncSnapshots(
          env,
          repository.owner,
          repository.name,
        );
      } catch (error) {
        reviewSignalWarning =
          error instanceof Error
            ? `PR Review 信号批量采集失败，已保留基础判断：${error.message}`
            : "PR Review 信号批量采集失败，已保留基础判断";
      }
    }

    for (const pull of pulls) {
      await upsertCommunityItem(
        env,
        repoId,
        "pr",
        pull,
        pullSnapshots.get(Number(pull.number)),
      );
    }
    for (const issue of realIssues) {
      await upsertCommunityItem(env, repoId, "issue", issue);
    }
    const capturedEvents = await captureRecentRepositoryEvents(env, repoId, base);
    let summaryResult = {
      analyzed: 0,
      provider: "none",
      providerName: "",
      warning: "",
    };
    if (userId) {
      try {
        summaryResult = await updatePendingSummaries(env, repoId, userId);
      } catch (error) {
        summaryResult.warning =
          error instanceof Error
            ? `AI 摘要已停止：${error.message}`
            : "AI 摘要已停止：未知错误";
      }
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
    await run(env, "DELETE FROM analysis_documents WHERE model = 'seed'");
    return {
      id: runId,
      repository: repoId,
      pulls: pulls.length,
      issues: realIssues.length,
      capturedEvents,
      analyzed: summaryResult.analyzed,
      summaryProvider: summaryResult.provider,
      summaryProviderName: summaryResult.providerName,
      reviewSignals: pullSnapshots.size,
      warning: [summaryResult.warning, reviewSignalWarning].filter(Boolean).join("；"),
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

