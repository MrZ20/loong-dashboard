import { decryptCredential } from "../credentials";
import type { WorkerEnv } from "../db";
import type { AITaskKey } from "../domain/ai-task-catalog";
import { HttpError } from "../http";
import {
  requestOpenAICompatible,
  type AIMessage,
  type OpenAICompatibleConfig,
} from "../integrations/ai/openai-compatible";
import { getActiveProviderId } from "../repositories/accounts";
import { findProviderRow } from "../repositories/ai-providers";
import {
  ensurePersistedAITask,
  markAITaskRun,
  resolveAITask,
  type ResolvedAITask,
} from "./ai-task-settings";

export interface ManagedAIResult {
  content: string;
  model: string;
  provider: "api" | "fallback";
  providerName: string;
  executionMode: "environment" | "account_api";
  taskKey: AITaskKey | null;
}

function normalizeBaseUrl(value: string | undefined) {
  return (value || "https://api.openai.com/v1").replace(/\/+$/, "");
}

async function providerConfig(
  env: WorkerEnv,
  userId: string,
  mode: "environment" | "account_api",
  providerId: string,
): Promise<OpenAICompatibleConfig> {
  if (mode === "account_api") {
    const row = await findProviderRow(env, userId, providerId);
    if (!row) throw new HttpError(409, "AI 任务绑定的账户 API 配置不存在，请在 AI 管理中重新选择");
    return {
      name: row.name,
      model: row.model,
      mode: row.api_mode === "responses" ? "responses" : "chat_completions",
      baseUrl: normalizeBaseUrl(row.base_url),
      token: await decryptCredential(env, row.encrypted_token),
      configured: Boolean(row.encrypted_token) || Boolean(row.base_url),
    };
  }
  return {
    name: "环境变量 OpenAI-compatible",
    model: env.AI_MODEL || "gpt-5-mini",
    mode: env.AI_API_MODE === "responses" ? "responses" : "chat_completions",
    baseUrl: normalizeBaseUrl(env.AI_API_BASE_URL),
    token: env.AI_API_KEY || "",
    configured: Boolean(env.AI_API_KEY),
  };
}

export async function executeResolvedAITask(
  env: WorkerEnv,
  input: {
    userId: string;
    task: ResolvedAITask;
    messages: AIMessage[];
    fallback: string;
  },
): Promise<ManagedAIResult> {
  if (input.task.executionMode === "opencode") {
    throw new HttpError(
      409,
      `${input.task.definition.name} 已配置为 OpenCode，必须通过本地 Runner 队列执行`,
    );
  }
  await ensurePersistedAITask(env, input.userId, input.task);
  await markAITaskRun(env, input.userId, input.task.key, "running");
  const config = await providerConfig(
    env,
    input.userId,
    input.task.executionMode,
    input.task.providerConfigId,
  );
  if (!config.configured) {
    await markAITaskRun(
      env,
      input.userId,
      input.task.key,
      "failed",
      "当前 AI 配置尚未提供可用 Token",
    );
    return {
      content: input.fallback,
      model: "fallback",
      provider: "fallback",
      providerName: config.name,
      executionMode: input.task.executionMode,
      taskKey: input.task.key,
    };
  }
  try {
    const content = await requestOpenAICompatible(config, input.messages);
    await markAITaskRun(env, input.userId, input.task.key, "ready");
    return {
      content,
      model: config.model,
      provider: "api",
      providerName: config.name,
      executionMode: input.task.executionMode,
      taskKey: input.task.key,
    };
  } catch (error) {
    await markAITaskRun(
      env,
      input.userId,
      input.task.key,
      "failed",
      error instanceof Error ? error.message : "AI 调用失败",
    );
    throw error;
  }
}

export async function executeAITask(
  env: WorkerEnv,
  input: {
    userId: string;
    taskKey: AITaskKey;
    messages: AIMessage[];
    fallback: string;
  },
) {
  const task = await resolveAITask(env, input.userId, input.taskKey);
  return executeResolvedAITask(env, { ...input, task });
}

export async function executeLegacyActiveProvider(
  env: WorkerEnv,
  userId: string,
  messages: AIMessage[],
  fallback: string,
): Promise<ManagedAIResult> {
  const active = await getActiveProviderId(env, userId);
  const providerId = active?.active_ai_provider_id || "environment";
  const mode = providerId === "environment" ? "environment" : "account_api";
  const config = await providerConfig(env, userId, mode, providerId);
  if (!config.configured) {
    return {
      content: fallback,
      model: "fallback",
      provider: "fallback",
      providerName: config.name,
      executionMode: mode,
      taskKey: null,
    };
  }
  const content = await requestOpenAICompatible(config, messages);
  return {
    content,
    model: config.model,
    provider: "api",
    providerName: config.name,
    executionMode: mode,
    taskKey: null,
  };
}

