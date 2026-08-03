import { first, query, run, type WorkerEnv } from "../db";

export interface ClassificationTaxonomyOverrideRow {
  user_id: string;
  repo_id: string;
  base_taxonomy_version: string;
  overlay_version: string;
  overlay_json: string;
  analysis_md: string;
  prompt_template_id: string | null;
  prompt_template_name: string;
  prompt_revision: number;
  prompt_version: string;
  provider: string;
  model: string;
  status: "running" | "ready" | "failed";
  last_error: string | null;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findClassificationTaxonomyOverride(
  env: WorkerEnv,
  userId: string,
  repoId: string,
) {
  return first<ClassificationTaxonomyOverrideRow>(
    env,
    `SELECT * FROM classification_taxonomy_overrides
     WHERE user_id = ? AND repo_id = ?`,
    [userId, repoId],
  );
}

export function listClassificationTaxonomySamples(
  env: WorkerEnv,
  repoId: string,
  limit = 80,
) {
  return query<Record<string, any>>(
    env,
    `SELECT kind, number, title, labels_json, diff_json, domain,
      domain_confidence, domain_evidence_json
     FROM community_items WHERE repo_id = ?
     ORDER BY updated_at DESC LIMIT ?`,
    [repoId, limit],
  );
}

export async function markClassificationTaxonomyRunning(
  env: WorkerEnv,
  input: { userId: string; repoId: string; baseVersion: string; now: string },
) {
  await run(
    env,
    `INSERT INTO classification_taxonomy_overrides(
      user_id, repo_id, base_taxonomy_version, overlay_version, status,
      created_at, updated_at
    ) VALUES(?, ?, ?, '', 'running', ?, ?)
    ON CONFLICT(user_id, repo_id) DO UPDATE SET
      base_taxonomy_version = excluded.base_taxonomy_version,
      status = 'running', last_error = NULL, updated_at = excluded.updated_at`,
    [input.userId, input.repoId, input.baseVersion, input.now, input.now],
  );
}

export async function saveClassificationTaxonomyOverride(
  env: WorkerEnv,
  input: {
    userId: string;
    repoId: string;
    baseVersion: string;
    overlayVersion: string;
    overlayJson: string;
    analysisMd: string;
    promptTemplateId: string;
    promptTemplateName: string;
    promptRevision: number;
    promptVersion: string;
    provider: string;
    model: string;
    now: string;
  },
) {
  await run(
    env,
    `UPDATE classification_taxonomy_overrides SET
      base_taxonomy_version = ?, overlay_version = ?, overlay_json = ?,
      analysis_md = ?, prompt_template_id = ?, prompt_template_name = ?,
      prompt_revision = ?, prompt_version = ?, provider = ?, model = ?,
      status = 'ready', last_error = NULL, last_refreshed_at = ?, updated_at = ?
     WHERE user_id = ? AND repo_id = ?`,
    [
      input.baseVersion, input.overlayVersion, input.overlayJson, input.analysisMd,
      input.promptTemplateId, input.promptTemplateName, input.promptRevision,
      input.promptVersion, input.provider, input.model, input.now, input.now,
      input.userId, input.repoId,
    ],
  );
}

export async function failClassificationTaxonomyRefresh(
  env: WorkerEnv,
  input: { userId: string; repoId: string; error: string; now: string },
) {
  await run(
    env,
    `UPDATE classification_taxonomy_overrides
     SET status = 'failed', last_error = ?, updated_at = ?
     WHERE user_id = ? AND repo_id = ?`,
    [input.error, input.now, input.userId, input.repoId],
  );
}
