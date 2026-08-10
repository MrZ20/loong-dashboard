import {
  first,
  query,
  run,
  type WorkerEnv,
} from "../db";

export type CommunityListQuery = {
  repo?: string | null;
  kind?: "pr" | "issue" | null;
  domain?: string | null;
  state?: "open" | "draft" | "merged" | "closed" | "reopened" | null;
  search?: string | null;
  updatedFrom?: string | null;
  updatedBefore?: string | null;
  sort: "updated" | "number";
  limit: number;
  offset: number;
};

const eventProjection = `
  (
    SELECT event_type FROM community_events
    WHERE community_events.item_id = community_items.id
      AND event_type != 'updated'
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  ) AS last_event_type,
  (
    SELECT occurred_at FROM community_events
    WHERE community_events.item_id = community_items.id
      AND event_type != 'updated'
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  ) AS last_event_at`;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildCommunityListWhere(input: CommunityListQuery) {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (input.repo) {
    conditions.push("repo_id = ?");
    bindings.push(input.repo);
  }
  if (input.kind) {
    conditions.push("kind = ?");
    bindings.push(input.kind);
  }
  if (input.domain) {
    conditions.push("domain = ?");
    bindings.push(input.domain);
  }
  if (input.state === "reopened") {
    conditions.push(`(
      SELECT event_type FROM community_events
      WHERE community_events.item_id = community_items.id
        AND event_type != 'updated'
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    ) = 'reopened'`);
  } else if (input.state) {
    conditions.push("state = ?");
    bindings.push(input.state);
  }
  if (input.updatedFrom) {
    conditions.push("updated_at >= ?");
    bindings.push(input.updatedFrom);
  }
  if (input.updatedBefore) {
    conditions.push("updated_at < ?");
    bindings.push(input.updatedBefore);
  }
  if (input.search) {
    conditions.push(`(
      title LIKE ? ESCAPE '\\'
      OR body_md LIKE ? ESCAPE '\\'
      OR ai_summary LIKE ? ESCAPE '\\'
      OR author LIKE ? ESCAPE '\\'
      OR CAST(number AS TEXT) LIKE ? ESCAPE '\\'
    )`);
    const like = `%${escapeLike(input.search.slice(0, 100))}%`;
    bindings.push(like, like, like, like, like);
  }

  return {
    clause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    bindings,
  };
}

export async function listCommunityRows(
  env: WorkerEnv,
  input: CommunityListQuery,
) {
  const where = buildCommunityListWhere(input);
  const orderBy = input.sort === "number"
    ? "number DESC, updated_at DESC, id DESC"
    : "updated_at DESC, number DESC, id DESC";

  return query<Record<string, any>>(
    env,
    `SELECT community_items.*, ${eventProjection}
     FROM community_items
     ${where.clause}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...where.bindings, input.limit, input.offset],
  );
}

export async function countCommunityRows(
  env: WorkerEnv,
  input: CommunityListQuery,
) {
  const where = buildCommunityListWhere(input);
  const row = await first<{ total: number }>(
    env,
    `SELECT COUNT(*) AS total FROM community_items ${where.clause}`,
    where.bindings,
  );
  return Number(row?.total ?? 0);
}

export async function listCommunityDomains(
  env: WorkerEnv,
  input: Pick<CommunityListQuery, "repo" | "kind">,
) {
  const conditions: string[] = ["domain != ''"];
  const bindings: unknown[] = [];
  if (input.repo) {
    conditions.push("repo_id = ?");
    bindings.push(input.repo);
  }
  if (input.kind) {
    conditions.push("kind = ?");
    bindings.push(input.kind);
  }
  const rows = await query<{ domain: string }>(
    env,
    `SELECT DISTINCT domain FROM community_items
     WHERE ${conditions.join(" AND ")}
     ORDER BY domain ASC`,
    bindings,
  );
  return rows.map((row) => row.domain).filter(Boolean);
}

export function findCommunityRow(
  env: WorkerEnv,
  repo: string,
  kind: string,
  number: number,
) {
  return first<Record<string, any>>(
    env,
    `SELECT community_items.*, ${eventProjection}
     FROM community_items
     WHERE repo_id = ? AND kind = ? AND number = ?`,
    [repo, kind, number],
  );
}

export function findPullWithRepository(
  env: WorkerEnv,
  repoId: string,
  number: number,
) {
  return first<Record<string, any>>(
    env,
    `SELECT community_items.*, repositories.owner, repositories.name
     FROM community_items
     JOIN repositories ON repositories.id = community_items.repo_id
     WHERE community_items.repo_id = ? AND community_items.kind = 'pr'
       AND community_items.number = ?`,
    [repoId, number],
  );
}

export function listCommunityAnalysisRows(
  env: WorkerEnv,
  kind: string,
  scope: string,
) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM analysis_documents
     WHERE type = ? AND scope = ?
     ORDER BY updated_at DESC LIMIT 10`,
    [kind, scope],
  );
}

export async function createCommunityAnalysis(
  env: WorkerEnv,
  input: {
    id: string;
    kind: string;
    scope: string;
    title: string;
    summaryMd: string;
    contentMd: string;
    prompt: string;
    promptTemplateId: string;
    promptTemplateName: string;
    promptRevision: number;
    model: string;
    baseSha: string | null;
    headSha: string | null;
    bodyHash: string;
    filesHash: string;
    promptType: string;
    promptVersion: string;
    runner: string;
    provider: string;
    analysisSource: "ai";
    evidenceCompleteness: string;
    versionStatus: "current" | "outdated";
    sourceRefs: string[];
    userId: string;
    createdAt: string;
  },
) {
  await run(
    env,
    `INSERT INTO analysis_documents (
      id, type, scope, title, summary_md, content_md, prompt,
      prompt_template_id, prompt_template_name, prompt_revision, model, status,
      base_sha, head_sha, body_hash, files_hash, prompt_type, prompt_version,
      runner, provider, analysis_source, evidence_completeness, version_status,
      created_by, source_refs_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.kind,
      input.scope,
      input.title,
      input.summaryMd,
      input.contentMd,
      input.prompt,
      input.promptTemplateId,
      input.promptTemplateName,
      input.promptRevision,
      input.model,
      input.baseSha,
      input.headSha,
      input.bodyHash,
      input.filesHash,
      input.promptType,
      input.promptVersion,
      input.runner,
      input.provider,
      input.analysisSource,
      input.evidenceCompleteness,
      input.versionStatus,
      input.userId,
      JSON.stringify(input.sourceRefs),
      input.createdAt,
      input.createdAt,
    ],
  );
  return first<Record<string, any>>(
    env,
    "SELECT * FROM analysis_documents WHERE id = ?",
    [input.id],
  );
}

export function updateCommunityDeepAnalysisStatus(
  env: WorkerEnv,
  itemId: string,
  status: "running" | "ready" | "outdated" | "failed",
  headSha?: string | null,
) {
  return run(
    env,
    `UPDATE community_items SET deep_analysis_status = ?,
      deep_analysis_head_sha = CASE WHEN ? = 'ready' THEN ? ELSE deep_analysis_head_sha END
     WHERE id = ?`,
    [status, status, headSha ?? null, itemId],
  );
}

export function updateCommunityDeepAnalysisStatusForVersion(
  env: WorkerEnv,
  input: {
    itemId: string;
    status: "ready" | "outdated" | "failed";
    headSha: string | null;
    bodyHash: string;
    filesHash: string;
  },
) {
  return run(
    env,
    `UPDATE community_items SET deep_analysis_status = ?,
      deep_analysis_head_sha = CASE WHEN ? = 'ready' THEN ? ELSE deep_analysis_head_sha END
     WHERE id = ? AND body_hash = ? AND files_hash = ?
       AND COALESCE(head_sha, '') = COALESCE(?, '')`,
    [
      input.status,
      input.status,
      input.headSha,
      input.itemId,
      input.bodyHash,
      input.filesHash,
      input.headSha,
    ],
  );
}

export function markCommunityDeepAnalysisOutdatedIfRunning(
  env: WorkerEnv,
  itemId: string,
) {
  return run(
    env,
    `UPDATE community_items SET deep_analysis_status = 'outdated'
     WHERE id = ? AND deep_analysis_status = 'running'`,
    [itemId],
  );
}
