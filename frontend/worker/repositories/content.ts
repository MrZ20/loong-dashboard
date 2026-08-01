import {
  first,
  query,
  run,
  type WorkerEnv,
} from "../db";

export function listWatchlistRows(env: WorkerEnv, userId: string) {
  return query<Record<string, any>>(
    env,
    `SELECT community_items.*, watchlist.reason, watchlist.note,
      watchlist.priority, watchlist.next_check,
      watchlist.created_at AS watched_at
     FROM watchlist
     JOIN community_items ON community_items.id = watchlist.item_id
     WHERE watchlist.user_id = ?
     ORDER BY
       CASE watchlist.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1
         WHEN 'P2' THEN 2 ELSE 3 END,
       watchlist.created_at DESC`,
    [userId],
  );
}

export function findCommunityItemId(env: WorkerEnv, itemId: string) {
  return first(env, "SELECT id FROM community_items WHERE id = ?", [itemId]);
}

export function deleteWatchlistItem(
  env: WorkerEnv,
  userId: string,
  itemId: string,
) {
  return run(
    env,
    "DELETE FROM watchlist WHERE user_id = ? AND item_id = ?",
    [userId, itemId],
  );
}

export function saveWatchlistItem(
  env: WorkerEnv,
  input: {
    userId: string;
    itemId: string;
    reason: string;
    note: string;
    priority: string;
    nextCheck: string | null;
    createdAt: string;
  },
) {
  return run(
    env,
    `INSERT INTO watchlist (
      user_id, item_id, reason, note, priority, next_check, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, item_id) DO UPDATE SET
      reason = excluded.reason, note = excluded.note,
      priority = excluded.priority, next_check = excluded.next_check`,
    [
      input.userId,
      input.itemId,
      input.reason,
      input.note,
      input.priority,
      input.nextCheck,
      input.createdAt,
    ],
  );
}

export function findAnalysisRow(env: WorkerEnv, id: string) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM analysis_documents WHERE id = ?",
    [id],
  );
}

export function listAnalysisRows(
  env: WorkerEnv,
  type: string | null,
  scope: string | null,
) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM analysis_documents
     WHERE (? IS NULL OR type = ?) AND (? IS NULL OR scope = ?)
     ORDER BY updated_at DESC LIMIT 100`,
    [type, type, scope, scope],
  );
}

export function listDocumentRows(
  env: WorkerEnv,
  category: string | null,
) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM technical_documents
     WHERE (? IS NULL OR category = ?)
     ORDER BY category, updated_at DESC`,
    [category, category],
  );
}

export async function createDocumentRow(
  env: WorkerEnv,
  input: {
    id: string;
    category: string;
    slug: string;
    title: string;
    summary: string;
    contentMd: string;
    tags: unknown[];
    sourceRefs: unknown[];
    authorId: string;
    createdAt: string;
  },
) {
  await run(
    env,
    `INSERT INTO technical_documents (
      id, category, slug, title, summary, content_md, tags_json,
      source_refs_json, author_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.category,
      input.slug,
      input.title,
      input.summary,
      input.contentMd,
      JSON.stringify(input.tags),
      JSON.stringify(input.sourceRefs),
      input.authorId,
      input.createdAt,
      input.createdAt,
    ],
  );
  return first<Record<string, any>>(
    env,
    "SELECT * FROM technical_documents WHERE id = ?",
    [input.id],
  );
}

export function findDocumentRow(env: WorkerEnv, idOrSlug: string) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM technical_documents WHERE id = ? OR slug = ?",
    [idOrSlug, idOrSlug],
  );
}

export function deleteDocumentRow(env: WorkerEnv, id: string) {
  return run(env, "DELETE FROM technical_documents WHERE id = ?", [id]);
}

export async function updateDocumentRow(
  env: WorkerEnv,
  input: {
    id: string;
    title: string;
    category: string;
    summary: string;
    contentMd: string;
    tags: unknown[];
    sourceRefs: unknown[];
    updatedAt: string;
  },
) {
  await run(
    env,
    `UPDATE technical_documents SET
      title = ?, category = ?, summary = ?, content_md = ?, tags_json = ?,
      source_refs_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.title,
      input.category,
      input.summary,
      input.contentMd,
      JSON.stringify(input.tags),
      JSON.stringify(input.sourceRefs),
      input.updatedAt,
      input.id,
    ],
  );
  return first<Record<string, any>>(
    env,
    "SELECT * FROM technical_documents WHERE id = ?",
    [input.id],
  );
}
