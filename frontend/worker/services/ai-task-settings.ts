import type { WorkerEnv } from "../db";
import {
  AI_PERMISSION_PROFILE_DEFINITIONS,
  AI_UPDATE_POLICIES,
  AI_WORKSPACE_MODES,
  type AIPermissionProfileId,
  type AIUpdatePolicy,
  type AIWorkspaceMode,
} from "../../shared/contracts/ai";
import {
  AI_TASK_CATALOG,
  getAITaskDefinition,
  type AIExecutionMode,
  type AITaskKey,
} from "../domain/ai-task-catalog";
import { HttpError } from "../http";
import {
  isLocalAgentEngine,
  localAgentEngineName,
  localAgentEngineStates,
} from "../domain/local-analysis";
import {
  clearAITaskRunError,
  findAITaskBindingRow,
  listAITaskBindingRows,
  saveAITaskBindingRow,
  updateAITaskRunState,
} from "../repositories/ai-task-bindings";
import { findProviderRow } from "../repositories/ai-providers";
import { findUserPromptTemplate } from "../repositories/prompts";
import { latestLocalRunner } from "../repositories/local-runner";
import { publicRunnerState } from "../domain/local-analysis";
import { resolvePrompt, type ResolvedPrompt } from "./prompt-resolution";

export interface ResolvedAITask {
  key: AITaskKey;
  executionMode: AIExecutionMode;
  providerConfigId: string;
  engineProviderId: string;
  engineModelId: string;
  reasoningEffort: string;
  workspaceMode: AIWorkspaceMode;
  updatePolicy: AIUpdatePolicy;
  permissionProfileId: AIPermissionProfileId;
  prompt: ResolvedPrompt;
  definition: (typeof AI_TASK_CATALOG)[number];
  persisted: boolean;
}

function resolveDefaultProviderConfigId() {
  return "environment";
}

function resolveWorkspaceMode(
  value: unknown,
  fallback: AIWorkspaceMode,
): AIWorkspaceMode {
  // Direct repository checkout was removed because it serialized concurrent
  // jobs and temporarily changed the shared checkout. Existing rows are
  // interpreted as isolated, per-job worktrees until they are saved again.
  if (value === "repository") return "ephemeral_worktree";
  return AI_WORKSPACE_MODES.includes(value as AIWorkspaceMode)
    ? value as AIWorkspaceMode
    : fallback;
}

export async function resolveAITask(
  env: WorkerEnv,
  userId: string,
  taskKey: AITaskKey,
): Promise<ResolvedAITask> {
  const definition = getAITaskDefinition(taskKey);
  const [binding, defaultProviderConfigId] = await Promise.all([
    findAITaskBindingRow(env, userId, taskKey),
    resolveDefaultProviderConfigId(),
  ]);
  const defaultMode = definition.defaultExecutionMode;
  const providerConfigId = binding?.provider_config_id || defaultProviderConfigId;
  const executionMode = binding?.execution_mode || defaultMode;
  const prompt = await resolvePrompt(
    env,
    userId,
    definition.featureKey,
    binding ? binding.prompt_template_id : undefined,
  );
  return {
    key: taskKey,
    executionMode,
    providerConfigId,
    engineProviderId: binding?.engine_provider_id || "",
    engineModelId: binding?.engine_model_id || "",
    reasoningEffort: binding?.reasoning_effort || "",
    workspaceMode: resolveWorkspaceMode(
      binding?.workspace_mode,
      definition.defaultWorkspaceMode,
    ),
    updatePolicy: binding?.update_policy || definition.defaultUpdatePolicy,
    permissionProfileId: binding?.permission_profile_id || definition.defaultPermissionProfileId,
    prompt,
    definition,
    persisted: Boolean(binding),
  };
}

export async function listAITaskSettings(env: WorkerEnv, userId: string) {
  const [rows, runner] = await Promise.all([
    listAITaskBindingRows(env, userId),
    latestLocalRunner(env),
  ]);
  const byKey = new Map(rows.map((row) => [row.task_key, row]));
  const defaultProviderConfigId = resolveDefaultProviderConfigId();
  const tasks = await Promise.all(AI_TASK_CATALOG.map(async (definition) => {
    const row = byKey.get(definition.key);
    const fallbackMode = definition.defaultExecutionMode;
    const executionMode = row?.execution_mode || fallbackMode;
    const prompt = await resolvePrompt(
      env,
      userId,
      definition.featureKey,
      row ? row.prompt_template_id : undefined,
    );
    return {
      key: definition.key,
      groupKey: definition.groupKey,
      groupName: definition.groupName,
      name: definition.name,
      description: definition.description,
      repoScope: definition.repoScope,
      featureKey: definition.featureKey,
      executionNote: definition.executionNote,
      executionMode,
      providerConfigId: row?.provider_config_id || defaultProviderConfigId,
      engineProviderId: row?.engine_provider_id || "",
      engineModelId: row?.engine_model_id || "",
      reasoningEffort: row?.reasoning_effort || "",
      workspaceMode: resolveWorkspaceMode(
        row?.workspace_mode,
        definition.defaultWorkspaceMode,
      ),
      updatePolicy: row?.update_policy || definition.defaultUpdatePolicy,
      permissionProfileId: row?.permission_profile_id || definition.defaultPermissionProfileId,
      promptTemplateId: prompt.templateId,
      promptTemplateName: prompt.name,
      promptRevision: prompt.revision,
      lastRunAt: row?.last_run_at ?? null,
      lastStatus: row?.last_status || "never",
      lastError: row?.last_error ?? null,
      persisted: Boolean(row),
    };
  }));
  const groupOrder = ["vllm", "vllm-ascend", "insights", "knowledge", "chat"];
  const groups = groupOrder.flatMap((groupKey) => {
    const grouped = tasks.filter((task) => task.groupKey === groupKey);
    return grouped.length ? [{ key: groupKey, name: grouped[0].groupName, tasks: grouped }] : [];
  });
  return {
    groups,
    runner: publicRunnerState(runner),
  };
}

export async function saveAITaskSettings(
  env: WorkerEnv,
  userId: string,
  taskKey: AITaskKey,
  input: {
    executionMode: AIExecutionMode;
    providerConfigId: string;
    engineProviderId: string;
    engineModelId: string;
    reasoningEffort: string;
    workspaceMode: AIWorkspaceMode;
    updatePolicy: AIUpdatePolicy;
    permissionProfileId: AIPermissionProfileId;
    promptTemplateId: string;
  },
) {
  const definition = getAITaskDefinition(taskKey);
  if (!AI_WORKSPACE_MODES.includes(input.workspaceMode)) {
    throw new HttpError(400, "工作区模式不正确");
  }
  if (!AI_UPDATE_POLICIES.includes(input.updatePolicy)) {
    throw new HttpError(400, "仓库更新策略不正确");
  }
  const permissionProfile = AI_PERMISSION_PROFILE_DEFINITIONS.find(
    (profile) => profile.id === input.permissionProfileId,
  );
  if (!permissionProfile) throw new HttpError(400, "权限档案不存在");
  if (input.executionMode !== "api" && !permissionProfile.engines.includes(input.executionMode)) {
    throw new HttpError(400, "当前执行引擎不支持所选权限档案");
  }
  if (input.permissionProfileId === "worktree_development" && input.workspaceMode === "none") {
    throw new HttpError(400, "隔离开发权限只能用于 Worktree 工作区");
  }
  let providerConfigId = input.providerConfigId || "environment";
  if (
    input.executionMode === "api" &&
    providerConfigId !== "environment" &&
    !(await findProviderRow(env, userId, providerConfigId))
  ) {
    throw new HttpError(400, "所选 API 配置不存在");
  }
  if (input.executionMode !== "api" && !input.engineModelId) {
    throw new HttpError(400, "本地 Agent 任务必须明确选择 Model");
  }
  if (isLocalAgentEngine(input.executionMode)) {
    const runner = await latestLocalRunner(env);
    const engineState = localAgentEngineStates(runner)
      .find((state) => state.engine === input.executionMode);
    if (engineState?.providers.length && !input.engineProviderId) {
      throw new HttpError(
        400,
        `${localAgentEngineName(input.executionMode)} 任务必须明确选择 Provider`,
      );
    }
    if (engineState && !engineState.permissionProfiles.includes(input.permissionProfileId)) {
      throw new HttpError(
        400,
        `${localAgentEngineName(input.executionMode)} Runner 未启用所选权限档案`,
      );
    }
  }
  const template = await findUserPromptTemplate(env, userId, input.promptTemplateId);
  if (!template || template.feature_key !== definition.featureKey) {
    throw new HttpError(400, "所选提示词不属于该 AI 功能");
  }
  if (!template.content.trim()) {
    throw new HttpError(409, "所选提示词为空，任务未执行");
  }
  await saveAITaskBindingRow(env, {
    userId,
    taskKey,
    executionMode: input.executionMode,
    providerConfigId,
    engineProviderId: input.engineProviderId,
    engineModelId: input.engineModelId,
    reasoningEffort: input.reasoningEffort,
    workspaceMode: input.executionMode === "api" ? "none" : input.workspaceMode,
    updatePolicy: input.executionMode === "api" ? "none" : input.updatePolicy,
    permissionProfileId: input.executionMode === "api" ? "safe_readonly" : input.permissionProfileId,
    promptTemplateId: input.promptTemplateId,
  });
  return resolveAITask(env, userId, taskKey);
}

export async function ensurePersistedAITask(
  env: WorkerEnv,
  userId: string,
  task: ResolvedAITask,
) {
  if (task.persisted) return;
  await saveAITaskBindingRow(env, {
    userId,
    taskKey: task.key,
    executionMode: task.executionMode,
    providerConfigId: task.providerConfigId,
    engineProviderId: task.engineProviderId,
    engineModelId: task.engineModelId,
    reasoningEffort: task.reasoningEffort,
    workspaceMode: task.workspaceMode,
    updatePolicy: task.updatePolicy,
    permissionProfileId: task.permissionProfileId,
    promptTemplateId: task.prompt.templateId,
  });
  task.persisted = true;
}

export function markAITaskRun(
  env: WorkerEnv,
  userId: string,
  taskKey: AITaskKey,
  status: "queued" | "running" | "ready" | "failed",
  error: string | null = null,
) {
  return updateAITaskRunState(env, { userId, taskKey, status, error });
}

export function clearAITaskError(
  env: WorkerEnv,
  userId: string,
  taskKey: AITaskKey,
) {
  return clearAITaskRunError(env, userId, taskKey);
}
