import { encryptCredential } from "../credentials";
import type { WorkerEnv } from "../db";
import { HttpError } from "../http";
import { ensureProfileRow } from "../repositories/accounts";
import {
  deleteProviderRow,
  findProviderByName,
  findProviderRow,
  listProviderRows,
  saveProviderRow,
} from "../repositories/ai-providers";
import {
  countProviderTaskUsage,
  listProviderTaskUsage,
} from "../repositories/ai-task-bindings";

function mapProvider(
  row: Record<string, any>,
  usedBy: string[] = [],
) {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    apiMode: row.api_mode,
    model: row.model,
    tokenConfigured: Boolean(row.encrypted_token),
    tokenHint: row.token_hint,
    builtIn: false,
    usageCount: usedBy.length,
    usedBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeProviderUrl(env: WorkerEnv, value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入有效的 AI API Base URL");
  }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(env.ALLOW_DEV_AUTH === "true" && localHost)) {
    throw new Error("AI API 地址必须使用 HTTPS；本地调试可使用 localhost");
  }
  if (
    env.ALLOW_DEV_AUTH !== "true" &&
    (/^(10|127|169\.254|192\.168)\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
      localHost)
  ) {
    throw new Error("生产环境不能连接私有网络 AI 地址");
  }
  return url.toString().replace(/\/+$/, "");
}

export async function getAIProviders(env: WorkerEnv, userId: string) {
  await ensureProfileRow(env, userId);
  const [rows, usageRows] = await Promise.all([
    listProviderRows(env, userId),
    listProviderTaskUsage(env, userId),
  ]);
  const usage = new Map<string, string[]>();
  for (const row of usageRows) {
    const tasks = usage.get(row.provider_config_id) ?? [];
    tasks.push(row.task_key);
    usage.set(row.provider_config_id, tasks);
  }
  return [
    {
      id: "environment",
      name: "环境变量 OpenAI-compatible",
      providerType: "openai-compatible",
      baseUrl: env.AI_API_BASE_URL || "https://api.openai.com/v1",
      apiMode: env.AI_API_MODE === "responses" ? "responses" : "chat_completions",
      model: env.AI_MODEL || "gpt-5-mini",
      tokenConfigured: Boolean(env.AI_API_KEY),
      tokenHint: "",
      builtIn: true,
      usageCount: usage.get("environment")?.length ?? 0,
      usedBy: usage.get("environment") ?? [],
    },
    ...rows.map((row) => mapProvider(row, usage.get(row.id) ?? [])),
  ];
}

export async function saveAIProvider(
  env: WorkerEnv,
  input: {
    userId: string;
    providerId?: string;
    name: string;
    baseUrl: string;
    apiMode: string;
    model: string;
    token: string;
  },
) {
  const existing = input.providerId
    ? await findProviderRow(env, input.userId, input.providerId)
    : null;
  if (input.providerId && !existing) return null;
  const duplicate = await findProviderByName(env, input.userId, input.name);
  if (duplicate && duplicate.id !== existing?.id) {
    return { conflict: true as const };
  }
  const encryptedToken = input.token
    ? await encryptCredential(env, input.token)
    : existing?.encrypted_token || "";
  const id = existing?.id || crypto.randomUUID();
  await ensureProfileRow(env, input.userId);
  const row = await saveProviderRow(env, {
    id,
    userId: input.userId,
    name: input.name,
    baseUrl: input.baseUrl,
    apiMode: input.apiMode,
    model: input.model,
    encryptedToken,
    tokenHint: input.token ? input.token.slice(-4) : existing?.token_hint || "",
    existing: Boolean(existing),
  });
  return { provider: mapProvider(row!), created: !existing };
}

export async function removeAIProvider(
  env: WorkerEnv,
  userId: string,
  providerId: string,
) {
  const provider = await findProviderRow(env, userId, providerId);
  if (!provider) return false;
  const usage = await countProviderTaskUsage(env, userId, providerId);
  if (Number(usage?.count ?? 0) > 0) {
    throw new HttpError(
      409,
      `该 AI 配置仍被 ${Number(usage?.count)} 个任务使用，请先在 AI 管理中切换这些任务`,
    );
  }
  await deleteProviderRow(env, userId, providerId);
  return true;
}
