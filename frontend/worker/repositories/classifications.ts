import { query, run, type WorkerEnv } from "../db";

export async function findLinkedPullDomains(
  env: WorkerEnv,
  repoId: string,
  body: string,
) {
  const numbers = new Set<number>();
  for (const match of body.matchAll(/(?:#|\/pull\/)(\d{1,8})\b/g)) {
    numbers.add(Number(match[1]));
    if (numbers.size >= 12) break;
  }
  if (!numbers.size) return [];
  const values = [...numbers];
  const rows = await query<{ domain: string }>(
    env,
    `SELECT domain FROM community_items
     WHERE repo_id = ? AND kind = 'pr'
       AND number IN (${values.map(() => "?").join(", ")})
       AND domain != '' AND domain != 'Other'`,
    [repoId, ...values],
  );
  return [...new Set(rows.map((row) => row.domain).filter(Boolean))];
}

export function listClassificationCandidates(
  env: WorkerEnv,
  input: {
    repoId: string;
    itemId?: string | null;
    maxItems: number;
    predicate: string;
  },
) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM community_items
     WHERE repo_id = ? AND classification_locked = 0
       AND (? IS NULL OR id = ?)
       AND (${input.predicate})
     ORDER BY updated_at DESC LIMIT ?`,
    [
      input.repoId,
      input.itemId ?? null,
      input.itemId ?? null,
      input.itemId ? 1 : input.maxItems,
    ],
  );
}

export function saveClassificationResult(
  env: WorkerEnv,
  input: {
    itemId: string;
    domain: string;
    source: string;
    confidence: number;
    assessment: unknown;
    headSha: string | null;
    bodyHash: string;
    filesHash: string;
    generatedAt: string;
    details: unknown;
  },
) {
  return run(
    env,
    `UPDATE community_items SET domain = ?, domain_source = ?,
      domain_confidence = ?, domain_evidence_json = ?,
      classification_status = 'ready', classification_head_sha = ?,
      classification_body_hash = ?, classification_files_hash = ?,
      classification_generated_at = ?, classification_details_json = ?,
      classification_error = NULL
     WHERE id = ? AND classification_locked = 0`,
    [
      input.domain,
      input.source,
      input.confidence,
      JSON.stringify(input.assessment),
      input.headSha,
      input.bodyHash,
      input.filesHash,
      input.generatedAt,
      JSON.stringify(input.details),
      input.itemId,
    ],
  );
}

export function markClassificationRunning(env: WorkerEnv, itemId: string) {
  return run(
    env,
    `UPDATE community_items SET classification_status = 'running',
      classification_error = NULL WHERE id = ? AND classification_locked = 0`,
    [itemId],
  );
}

export function findClassificationItemVersion(env: WorkerEnv, itemId: string) {
  return query<Record<string, any>>(
    env,
    `SELECT id, repo_id, kind, number, head_sha, body_hash, files_hash,
      classification_locked FROM community_items WHERE id = ? LIMIT 1`,
    [itemId],
  ).then((rows) => rows[0]);
}

export function markClassificationFailed(
  env: WorkerEnv,
  itemId: string,
  message: string,
) {
  return run(
    env,
    `UPDATE community_items SET classification_status = 'failed',
      classification_error = ? WHERE id = ? AND classification_locked = 0`,
    [message, itemId],
  );
}
