import { first, query, run, type WorkerEnv } from "../db";

export function findFactItem(env: WorkerEnv, itemId: string) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM community_items WHERE id = ?",
    [itemId],
  );
}

export function findFactRepository(env: WorkerEnv, repoId: string) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM repositories WHERE id = ?",
    [repoId],
  );
}

export function insertFactEvent(
  env: WorkerEnv,
  input: {
    id: string;
    repoId: string;
    itemId: string;
    eventType: string;
    occurredAt: string;
    observedAt: string;
    source: "github" | "facts";
    actor: string | null;
  },
) {
  return run(
    env,
    `INSERT INTO community_events(
      id, repo_id, item_id, event_type, occurred_at, observed_at, source, actor
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id, event_type, occurred_at) DO NOTHING`,
    [
      input.id,
      input.repoId,
      input.itemId,
      input.eventType,
      input.occurredAt,
      input.observedAt,
      input.source,
      input.actor,
    ],
  );
}

export function saveCommunityFact(
  env: WorkerEnv,
  input: {
    id: string;
    repoId: string;
    kind: "pr" | "issue";
    number: number;
    state: string;
    title: string;
    author: string;
    authorAvatar: string | null;
    body: string;
    htmlUrl: string | null;
    comments: number;
    labels: string[];
    excerpt: string;
    statusText: string;
    important: number;
    updatedAt: string;
    createdAt: string | null;
    mergedAt: string | null;
    closedAt: string | null;
    isDraft: boolean;
    contentHash: string;
    summaryInputHash: string;
    fetchedAt: string;
    baseSha: string | null;
    headSha: string | null;
    mergeCommitSha: string | null;
    bodyHash: string;
    filesHash: string;
    factsHash: string;
    bodyChangedAt: string | null;
    codeChangedAt: string | null;
    anyChangedAt: string;
    diff: Record<string, any> | null;
    reviewSignal: Record<string, any> | null;
    summaryStale: boolean;
    classificationStale: boolean;
  },
) {
  return run(
    env,
    `INSERT INTO community_items(
      id, repo_id, kind, number, state, title, author, author_avatar, body_md,
      html_url, comments, labels_json, domain, ai_summary, status_text, important,
      updated_at, created_at, merged_at, closed_at, is_draft, content_hash,
      summary_input_hash, summary_source, fetched_at, base_sha, head_sha,
      merge_commit_sha, body_hash, files_hash, facts_hash, facts_refreshed_at,
      body_changed_at, code_changed_at, any_changed_at, diff_json,
      diff_files_count, additions, deletions, review_signal_json,
      review_signal_updated_at, summary_status, classification_status,
      deep_analysis_status
    ) VALUES(
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, 'Other', ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, 'excerpt',
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, 'missing', 'missing', 'missing'
    )
    ON CONFLICT(repo_id, kind, number) DO UPDATE SET
      state = excluded.state, title = excluded.title, author = excluded.author,
      author_avatar = excluded.author_avatar, body_md = excluded.body_md,
      html_url = excluded.html_url, comments = excluded.comments,
      labels_json = excluded.labels_json, status_text = excluded.status_text,
      important = excluded.important, updated_at = excluded.updated_at,
      created_at = COALESCE(excluded.created_at, community_items.created_at),
      merged_at = excluded.merged_at, closed_at = excluded.closed_at,
      is_draft = excluded.is_draft, content_hash = excluded.content_hash,
      fetched_at = excluded.fetched_at, base_sha = excluded.base_sha,
      head_sha = excluded.head_sha, merge_commit_sha = excluded.merge_commit_sha,
      body_hash = excluded.body_hash, files_hash = excluded.files_hash,
      facts_hash = excluded.facts_hash, facts_refreshed_at = excluded.facts_refreshed_at,
      body_changed_at = CASE WHEN community_items.body_hash != excluded.body_hash
        THEN excluded.facts_refreshed_at ELSE community_items.body_changed_at END,
      code_changed_at = CASE
        WHEN COALESCE(community_items.head_sha, '') != COALESCE(excluded.head_sha, '')
          OR community_items.files_hash != excluded.files_hash
        THEN excluded.facts_refreshed_at ELSE community_items.code_changed_at END,
      any_changed_at = CASE WHEN community_items.facts_hash != excluded.facts_hash
        THEN excluded.facts_refreshed_at ELSE community_items.any_changed_at END,
      diff_json = excluded.diff_json,
      diff_files_count = excluded.diff_files_count,
      additions = excluded.additions, deletions = excluded.deletions,
      review_signal_json = excluded.review_signal_json,
      review_signal_updated_at = excluded.review_signal_updated_at,
      summary_status = CASE WHEN ? THEN 'stale' ELSE community_items.summary_status END,
      summary_error = CASE WHEN ? THEN NULL ELSE community_items.summary_error END,
      classification_status = CASE
        WHEN community_items.classification_locked = 0 AND ? THEN 'possibly_stale'
        ELSE community_items.classification_status END,
      deep_analysis_status = CASE
        WHEN COALESCE(community_items.head_sha, '') != COALESCE(excluded.head_sha, '')
          AND community_items.deep_analysis_status = 'ready'
        THEN 'outdated' ELSE community_items.deep_analysis_status END`,
    [
      input.id,
      input.repoId,
      input.kind,
      input.number,
      input.state,
      input.title,
      input.author,
      input.authorAvatar,
      input.body,
      input.htmlUrl,
      input.comments,
      JSON.stringify(input.labels),
      input.excerpt,
      input.statusText,
      input.important,
      input.updatedAt,
      input.createdAt,
      input.mergedAt,
      input.closedAt,
      input.isDraft ? 1 : 0,
      input.contentHash,
      input.summaryInputHash,
      input.fetchedAt,
      input.baseSha,
      input.headSha,
      input.mergeCommitSha,
      input.bodyHash,
      input.filesHash,
      input.factsHash,
      input.fetchedAt,
      input.bodyChangedAt,
      input.codeChangedAt,
      input.anyChangedAt,
      input.diff ? JSON.stringify(input.diff) : null,
      Number(input.diff?.files ?? 0),
      Number(input.diff?.additions ?? 0),
      Number(input.diff?.deletions ?? 0),
      JSON.stringify(input.reviewSignal ?? {}),
      input.reviewSignal?.updatedAt ?? null,
      input.summaryStale ? 1 : 0,
      input.summaryStale ? 1 : 0,
      input.classificationStale ? 1 : 0,
    ],
  );
}

export function markCurrentAnalysisOutdated(env: WorkerEnv, itemId: string) {
  return run(
    env,
    `UPDATE analysis_documents SET version_status = 'outdated'
     WHERE scope = ? AND type = 'pr' AND version_status = 'current'`,
    [itemId],
  );
}

export function countCommunityKinds(env: WorkerEnv, repoId: string) {
  return query<{ kind: string; count: number }>(
    env,
    `SELECT kind, COUNT(*) AS count FROM community_items
     WHERE repo_id = ? GROUP BY kind`,
    [repoId],
  );
}

export function updateRepositoryFactStats(
  env: WorkerEnv,
  input: {
    repoId: string;
    pullCount: number;
    issueCount: number;
    finishedAt: string;
  },
) {
  return run(
    env,
    `UPDATE repositories SET open_pull_count = ?, open_issue_count = ?,
      last_synced_at = ?, sync_status = 'ready' WHERE id = ?`,
    [input.pullCount, input.issueCount, input.finishedAt, input.repoId],
  );
}

export function scheduleClassificationIfPending(
  env: WorkerEnv,
  input: { userId: string; repoId: string; scheduledAt: string },
) {
  return run(
    env,
    `UPDATE refresh_task_configs SET next_scheduled_at = ?, updated_at = ?
     WHERE user_id = ? AND repo_id = ? AND task_type = 'classification'
       AND auto_enabled = 1 AND refresh_rule != 'manual'
       AND EXISTS(
         SELECT 1 FROM community_items
         WHERE repo_id = ? AND classification_locked = 0
           AND (
             classification_status IN ('missing', 'failed')
             OR (
               refresh_task_configs.refresh_rule = 'code_only'
               AND classification_status = 'possibly_stale' AND kind = 'pr'
               AND (
                 COALESCE(classification_head_sha, '') != COALESCE(head_sha, '')
                 OR classification_files_hash != files_hash
               )
             )
             OR (
               refresh_task_configs.refresh_rule = 'any_update'
               AND classification_status = 'possibly_stale'
             )
           )
       )`,
    [input.scheduledAt, input.scheduledAt, input.userId, input.repoId, input.repoId],
  );
}
