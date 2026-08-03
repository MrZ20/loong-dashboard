import { first, query, run, type WorkerEnv } from "../db";
import type { PromptFeatureKey } from "../domain/prompt-catalog";

export interface PromptTemplateRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  feature_key: PromptFeatureKey;
  name: string;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export function listUserPromptTemplates(env: WorkerEnv, userId: string) {
  return query<PromptTemplateRow>(
    env,
    `SELECT * FROM ai_prompt_templates
     WHERE user_id = ?
     ORDER BY feature_key, updated_at DESC`,
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
    "SELECT * FROM ai_prompt_templates WHERE id = ? AND user_id = ?",
    [templateId, userId],
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
     WHERE user_id = ? AND feature_key = ? AND name = ?`,
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
      id, user_id, feature_key, name, content, revision, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, 1, ?, ?)`,
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
     WHERE id = ? AND user_id = ?`,
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
    "DELETE FROM ai_prompt_templates WHERE id = ? AND user_id = ?",
    [templateId, userId],
  );
}

export function listPromptPreferences(env: WorkerEnv, userId: string) {
  return query<{ feature_key: PromptFeatureKey; active_template_id: string | null }>(
    env,
    "SELECT feature_key, active_template_id FROM ai_prompt_preferences WHERE user_id = ?",
    [userId],
  );
}

export function findPromptPreference(
  env: WorkerEnv,
  userId: string,
  featureKey: PromptFeatureKey,
) {
  return first<{ active_template_id: string | null }>(
    env,
    `SELECT active_template_id FROM ai_prompt_preferences
     WHERE user_id = ? AND feature_key = ?`,
    [userId, featureKey],
  );
}

export function savePromptPreference(
  env: WorkerEnv,
  userId: string,
  featureKey: PromptFeatureKey,
  activeTemplateId: string | null,
  updatedAt: string,
) {
  return run(
    env,
    `INSERT INTO ai_prompt_preferences(
      user_id, feature_key, active_template_id, updated_at
    ) VALUES(?, ?, ?, ?)
    ON CONFLICT(user_id, feature_key) DO UPDATE SET
      active_template_id = excluded.active_template_id,
      updated_at = excluded.updated_at`,
    [userId, featureKey, activeTemplateId, updatedAt],
  );
}
