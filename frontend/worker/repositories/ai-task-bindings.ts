import { first, query, run, type WorkerEnv } from "../db";
import type {
  AIExecutionMode,
  AITaskKey,
} from "../domain/ai-task-catalog";

export interface AITaskBindingRow extends Record<string, unknown> {
  user_id: string;
  task_key: AITaskKey;
  execution_mode: AIExecutionMode;
  provider_config_id: string;
  opencode_provider_id: string;
  opencode_model_id: string;
  prompt_template_id: string | null;
  last_run_at: string | null;
  last_status: "never" | "queued" | "running" | "ready" | "failed";
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function listAITaskBindingRows(env: WorkerEnv, userId: string) {
  return query<AITaskBindingRow>(
    env,
    "SELECT * FROM ai_task_bindings WHERE user_id = ? ORDER BY task_key",
    [userId],
  );
}

export function findAITaskBindingRow(
  env: WorkerEnv,
  userId: string,
  taskKey: AITaskKey,
) {
  return first<AITaskBindingRow>(
    env,
    "SELECT * FROM ai_task_bindings WHERE user_id = ? AND task_key = ?",
    [userId, taskKey],
  );
}

export function saveAITaskBindingRow(
  env: WorkerEnv,
  input: {
    userId: string;
    taskKey: AITaskKey;
    executionMode: AIExecutionMode;
    providerConfigId: string;
    opencodeProviderId: string;
    opencodeModelId: string;
    promptTemplateId: string | null;
  },
) {
  const now = new Date().toISOString();
  return run(
    env,
    `INSERT INTO ai_task_bindings(
      user_id, task_key, execution_mode, provider_config_id,
      opencode_provider_id, opencode_model_id, prompt_template_id,
      created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, task_key) DO UPDATE SET
      execution_mode = excluded.execution_mode,
      provider_config_id = excluded.provider_config_id,
      opencode_provider_id = excluded.opencode_provider_id,
      opencode_model_id = excluded.opencode_model_id,
      prompt_template_id = excluded.prompt_template_id,
      updated_at = excluded.updated_at`,
    [
      input.userId,
      input.taskKey,
      input.executionMode,
      input.providerConfigId,
      input.opencodeProviderId,
      input.opencodeModelId,
      input.promptTemplateId,
      now,
      now,
    ],
  );
}

export function updateAITaskRunState(
  env: WorkerEnv,
  input: {
    userId: string;
    taskKey: AITaskKey;
    status: "queued" | "running" | "ready" | "failed";
    error?: string | null;
  },
) {
  const now = new Date().toISOString();
  return run(
    env,
    `UPDATE ai_task_bindings SET last_run_at = ?, last_status = ?,
      last_error = ?, updated_at = ?
     WHERE user_id = ? AND task_key = ?`,
    [now, input.status, input.error ?? null, now, input.userId, input.taskKey],
  );
}

export function listProviderTaskUsage(env: WorkerEnv, userId: string) {
  return query<{ provider_config_id: string; task_key: AITaskKey }>(
    env,
    `SELECT provider_config_id, task_key FROM ai_task_bindings
     WHERE user_id = ? AND execution_mode IN ('environment', 'account_api')`,
    [userId],
  );
}

export function countProviderTaskUsage(
  env: WorkerEnv,
  userId: string,
  providerId: string,
) {
  return first<{ count: number }>(
    env,
    `SELECT COUNT(*) AS count FROM ai_task_bindings
     WHERE user_id = ? AND execution_mode = 'account_api'
       AND provider_config_id = ?`,
    [userId, providerId],
  );
}

export function replacePromptTemplateBindings(
  env: WorkerEnv,
  input: {
    userId: string;
    promptTemplateId: string;
    fallbackTemplateId: string;
  },
) {
  return run(
    env,
    `UPDATE ai_task_bindings
     SET prompt_template_id = ?, updated_at = ?
     WHERE user_id = ? AND prompt_template_id = ?`,
    [
      input.fallbackTemplateId,
      new Date().toISOString(),
      input.userId,
      input.promptTemplateId,
    ],
  );
}
