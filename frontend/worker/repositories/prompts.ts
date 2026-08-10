import { first, query, run, type WorkerEnv } from "../db";
import type { PromptFeatureKey } from "../domain/prompt-catalog";

export interface PromptTemplateRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  feature_key: PromptFeatureKey;
  name: string;
  content: string;
  revision: number;
  is_default: number;
  is_seed: number;
  created_at: string;
  updated_at: string;
}

export function listUserPromptTemplates(env: WorkerEnv, userId: string) {
  return query<PromptTemplateRow>(
    env,
    `SELECT * FROM ai_prompt_templates
     WHERE user_id = ? AND is_seed = 0
     ORDER BY feature_key, is_default DESC, updated_at DESC`,
    [userId],
  );
}

export function findUserPromptTemplate(
  env: WorkerEnv,
  userId: string,
  templateId: string,
) {
  return first<PromptTemplateRow>(
    env,
    "SELECT * FROM ai_prompt_templates WHERE id = ? AND user_id = ? AND is_seed = 0",
    [templateId, userId],
  );
}

export function findDefaultPromptTemplate(
  env: WorkerEnv,
  userId: string,
  featureKey: PromptFeatureKey,
) {
  return first<PromptTemplateRow>(
    env,
    `SELECT * FROM ai_prompt_templates
     WHERE user_id = ? AND feature_key = ? AND is_default = 1 AND is_seed = 0`,
    [userId, featureKey],
  );
}

export function ensureDefaultPromptTemplates(env: WorkerEnv, userId: string) {
  const now = new Date().toISOString();
  return run(
    env,
    `INSERT INTO ai_prompt_templates(
       id, user_id, feature_key, name, content, revision,
       is_default, is_seed, created_at, updated_at
     )
     SELECT
       'default:' || ? || ':' || seeds.feature_key,
       ?, seeds.feature_key, seeds.name, seeds.content, seeds.revision,
       1, 0, ?, ?
     FROM ai_prompt_templates AS seeds
     WHERE seeds.is_seed = 1
       AND NOT EXISTS(
         SELECT 1 FROM ai_prompt_templates AS existing
         WHERE existing.user_id = ?
           AND existing.feature_key = seeds.feature_key
           AND existing.is_default = 1
           AND existing.is_seed = 0
       )`,
    [userId, userId, now, now, userId],
  );
}

export function findPromptTemplateByName(
  env: WorkerEnv,
  userId: string,
  featureKey: PromptFeatureKey,
  name: string,
) {
  return first<PromptTemplateRow>(
    env,
    `SELECT * FROM ai_prompt_templates
     WHERE user_id = ? AND feature_key = ? AND name = ? AND is_seed = 0`,
    [userId, featureKey, name],
  );
}

export function createPromptTemplateRow(
  env: WorkerEnv,
  input: {
    id: string;
    userId: string;
    featureKey: PromptFeatureKey;
    name: string;
    content: string;
    createdAt: string;
  },
) {
  return run(
    env,
    `INSERT INTO ai_prompt_templates(
      id, user_id, feature_key, name, content, revision,
      is_default, is_seed, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`,
    [
      input.id,
      input.userId,
      input.featureKey,
      input.name,
      input.content,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export function updatePromptTemplateRow(
  env: WorkerEnv,
  input: {
    id: string;
    userId: string;
    name: string;
    content: string;
    updatedAt: string;
  },
) {
  return run(
    env,
    `UPDATE ai_prompt_templates
     SET name = ?, content = ?, revision = revision + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND is_seed = 0`,
    [input.name, input.content, input.updatedAt, input.id, input.userId],
  );
}

export function deletePromptTemplateRow(
  env: WorkerEnv,
  userId: string,
  templateId: string,
) {
  return run(
    env,
    "DELETE FROM ai_prompt_templates WHERE id = ? AND user_id = ? AND is_seed = 0",
    [templateId, userId],
  );
}
