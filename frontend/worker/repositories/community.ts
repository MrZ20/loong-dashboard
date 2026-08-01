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
  state?: string | null;
  search?: string | null;
  since?: string | null;
  limit: number;
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

export async function listCommunityRows(
  env: WorkerEnv,
  input: CommunityListQuery,
) {
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
  if (input.state) {
    conditions.push("state = ?");
    bindings.push(input.state);
  }
  if (input.since) {
    conditions.push("updated_at >= ?");
    bindings.push(input.since);
  }
  if (input.search) {
    conditions.push("(title LIKE ? OR body_md LIKE ? OR author LIKE ?)");
    const like = `%${input.search.slice(0, 100)}%`;
    bindings.push(like, like, like);
  }

  return query<Record<string, any>>(
    env,
    `SELECT community_items.*, ${eventProjection}
     FROM community_items
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY important DESC, updated_at DESC
     LIMIT ?`,
    [...bindings, input.limit],
  );
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
    model: string;
    userId: string;
    createdAt: string;
  },
) {
  await run(
    env,
    `INSERT INTO analysis_documents (
      id, type, scope, title, summary_md, content_md, prompt, model, status,
      created_by, source_refs_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    [
      input.id,
      input.kind,
      input.scope,
      input.title,
      input.summaryMd,
      input.contentMd,
      input.prompt,
      input.model,
      input.userId,
      JSON.stringify([input.scope]),
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
