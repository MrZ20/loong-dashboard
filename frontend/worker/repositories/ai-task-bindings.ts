import { first, query, run, type WorkerEnv } from "../db";
import type {
  AIExecutionMode,
  AIPermissionProfileId,
  AIUpdatePolicy,
  AIWorkspaceMode,
  AITaskKey,
} from "../domain/ai-task-catalog";

export interface AITaskBindingRow extends Record<string, unknown> {
  user_id: string;
  task_key: AITaskKey;
  execution_mode: AIExecutionMode;
  provider_config_id: string;
  engine_provider_id: string;
  engine_model_id: string;
  reasoning_effort: string;
  workspace_mode: AIWorkspaceMode;
  update_policy: AIUpdatePolicy;
  permission_profile_id: AIPermissionProfileId;
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
    engineProviderId: string;
    engineModelId: string;
    reasoningEffort: string;
    workspaceMode: AIWorkspaceMode;
    updatePolicy: AIUpdatePolicy;
    permissionProfileId: AIPermissionProfileId;
    promptTemplateId: string | null;
  },
) {
  const now = new Date().toISOString();
  return run(
    env,
    `INSERT INTO ai_task_bindings(
      user_id, task_key, execution_mode, provider_config_id,
      engine_provider_id, engine_model_id, reasoning_effort,
      workspace_mode, update_policy, permission_profile_id,
      prompt_template_id, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, task_key) DO UPDATE SET
      execution_mode = excluded.execution_mode,
      provider_config_id = excluded.provider_config_id,
      engine_provider_id = excluded.engine_provider_id,
      engine_model_id = excluded.engine_model_id,
      reasoning_effort = excluded.reasoning_effort,
      workspace_mode = excluded.workspace_mode,
      update_policy = excluded.update_policy,
      permission_profile_id = excluded.permission_profile_id,
      prompt_template_id = excluded.prompt_template_id,
      last_run_at = NULL,
      last_status = 'never',
      last_error = NULL,
      updated_at = excluded.updated_at`,
    [
      input.userId,
      input.taskKey,
      input.executionMode,
      input.providerConfigId,
      input.engineProviderId,
      input.engineModelId,
      input.reasoningEffort,
      input.workspaceMode,
      input.updatePolicy,
      input.permissionProfileId,
      input.promptTemplateId,
      now,
      now,
    ],
  );
}

export function clearAITaskRunError(
  env: WorkerEnv,
  userId: string,
  taskKey: AITaskKey,
) {
  return run(
    env,
    `UPDATE ai_task_bindings SET
      last_status = CASE WHEN last_status = 'failed' THEN 'never' ELSE last_status END,
      last_error = NULL, updated_at = ?
     WHERE user_id = ? AND task_key = ?`,
    [new Date().toISOString(), userId, taskKey],
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
     WHERE user_id = ? AND execution_mode = 'api'`,
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
     WHERE user_id = ? AND execution_mode = 'api'
       AND provider_config_id = ?`,
    [userId, providerId],
  );
}

export function countPromptTemplateBindings(
  env: WorkerEnv,
  userId: string,
  promptTemplateId: string,
) {
  return first<{ count: number }>(
    env,
    `SELECT COUNT(*) AS count FROM ai_task_bindings
     WHERE user_id = ? AND prompt_template_id = ?`,
    [userId, promptTemplateId],
  );
}
