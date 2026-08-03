import type { WorkerEnv } from "../db";
import {
  AI_TASK_CATALOG,
  getAITaskDefinition,
  type AIExecutionMode,
  type AITaskKey,
} from "../domain/ai-task-catalog";
import { builtInPromptId } from "../domain/prompt-catalog";
import { HttpError } from "../http";
import { getActiveProviderId } from "../repositories/accounts";
import {
  findAITaskBindingRow,
  listAITaskBindingRows,
  saveAITaskBindingRow,
  updateAITaskRunState,
} from "../repositories/ai-task-bindings";
import { findProviderRow } from "../repositories/ai-providers";
import { findUserPromptTemplate } from "../repositories/prompts";
import { ensureLocalRunnerSettings, latestLocalRunner } from "../repositories/local-runner";
import { publicRunnerState } from "../domain/local-analysis";
import { resolvePrompt, type ResolvedPrompt } from "./prompt-resolution";

export interface ResolvedAITask {
  key: AITaskKey;
  executionMode: AIExecutionMode;
  providerConfigId: string;
  opencodeProviderId: string;
  opencodeModelId: string;
  prompt: ResolvedPrompt;
  definition: (typeof AI_TASK_CATALOG)[number];
  persisted: boolean;
}

async function defaultDirectProvider(env: WorkerEnv, userId: string) {
  const active = await getActiveProviderId(env, userId);
  return active?.active_ai_provider_id || "environment";
}

export async function resolveAITask(
  env: WorkerEnv,
  userId: string,
  taskKey: AITaskKey,
): Promise<ResolvedAITask> {
  const definition = getAITaskDefinition(taskKey);
  const [binding, localSettings, legacyProviderId] = await Promise.all([
    findAITaskBindingRow(env, userId, taskKey),
    ensureLocalRunnerSettings(env, userId),
    defaultDirectProvider(env, userId),
  ]);
  const defaultMode = definition.defaultExecutionMode;
  const providerConfigId = binding?.provider_config_id || legacyProviderId;
  const executionMode = binding?.execution_mode || (
    defaultMode === "opencode"
      ? "opencode"
      : providerConfigId === "environment" ? "environment" : "account_api"
  );
  const prompt = await resolvePrompt(
    env,
    userId,
    definition.featureKey,
    binding ? binding.prompt_template_id : undefined,
  );
  return {
    key: taskKey,
    executionMode,
    providerConfigId: executionMode === "environment" ? "environment" : providerConfigId,
    opencodeProviderId: binding?.opencode_provider_id || localSettings?.default_provider || "",
    opencodeModelId: binding?.opencode_model_id || localSettings?.default_model || "",
    prompt,
    definition,
    persisted: Boolean(binding),
  };
}

export async function listAITaskSettings(env: WorkerEnv, userId: string) {
  const [rows, localSettings, runner] = await Promise.all([
    listAITaskBindingRows(env, userId),
    ensureLocalRunnerSettings(env, userId),
    latestLocalRunner(env),
  ]);
  const byKey = new Map(rows.map((row) => [row.task_key, row]));
  const activeProviderId = await defaultDirectProvider(env, userId);
  const tasks = await Promise.all(AI_TASK_CATALOG.map(async (definition) => {
    const row = byKey.get(definition.key);
    const fallbackMode = definition.defaultExecutionMode === "opencode"
      ? "opencode"
      : activeProviderId === "environment" ? "environment" : "account_api";
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
      providerConfigId: executionMode === "environment"
        ? "environment"
        : row?.provider_config_id || activeProviderId,
      opencodeProviderId: row?.opencode_provider_id || localSettings?.default_provider || "",
      opencodeModelId: row?.opencode_model_id || localSettings?.default_model || "",
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
    opencodeProviderId: string;
    opencodeModelId: string;
    promptTemplateId: string;
  },
) {
  const definition = getAITaskDefinition(taskKey);
  let providerConfigId = input.providerConfigId || "environment";
  if (input.executionMode === "environment") providerConfigId = "environment";
  if (
    input.executionMode === "account_api" &&
    !(await findProviderRow(env, userId, providerConfigId))
  ) {
    throw new HttpError(400, "所选账户 API 配置不存在");
  }
  const builtInId = builtInPromptId(definition.featureKey);
  if (input.promptTemplateId !== builtInId) {
    const template = await findUserPromptTemplate(env, userId, input.promptTemplateId);
    if (!template || template.feature_key !== definition.featureKey) {
      throw new HttpError(400, "所选提示词不属于该 AI 功能");
    }
  }
  await saveAITaskBindingRow(env, {
    userId,
    taskKey,
    executionMode: input.executionMode,
    providerConfigId,
    opencodeProviderId: input.opencodeProviderId,
    opencodeModelId: input.opencodeModelId,
    promptTemplateId: input.promptTemplateId === builtInId
      ? builtInId
      : input.promptTemplateId,
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
    opencodeProviderId: task.opencodeProviderId,
    opencodeModelId: task.opencodeModelId,
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
