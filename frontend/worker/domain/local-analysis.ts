import {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_ENGINE_DEFINITIONS,
  LOCAL_AGENT_ENGINES,
  type LocalAgentCapability,
  type LocalAgentEngine,
  type LocalAgentEngineState,
} from "../../shared/contracts/local-agent";
import type { AITaskKey } from "../../shared/contracts/ai";

export {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_ENGINE_DEFINITIONS,
  LOCAL_AGENT_ENGINES,
  type LocalAgentCapability,
  type LocalAgentEngine,
  type LocalAgentEngineState,
} from "../../shared/contracts/local-agent";

export const LOCAL_JOB_TYPES = [
  "deep_analysis",
  "insight_evidence",
  "repository_chat",
  "managed_ai_task",
  "runner_check",
  "repository_check",
  "repository_clone",
  "provider_refresh",
  "worktree_cleanup",
] as const;

export type LocalJobType = (typeof LOCAL_JOB_TYPES)[number];

export const LOCAL_JOB_STATUSES = [
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;

export type LocalJobStatus = (typeof LOCAL_JOB_STATUSES)[number];

export const LOCAL_EVENT_TYPES = [
  "task_started",
  "repository_prepare",
  "git_fetch",
  "worktree_create",
  "worktree_cleanup",
  "file_read",
  "symbol_search",
  "git_query",
  "model_call",
  "report_generate",
  "task_completed",
  "warning",
  "error",
] as const;

export type LocalEventType = (typeof LOCAL_EVENT_TYPES)[number];

export type CodeReference = {
  repository: "vllm" | "vllm-ascend";
  commitSha: string;
  path: string;
  symbol: string;
  startLine: number | null;
  endLine: number | null;
  reason: string;
};

export const LOCAL_JOB_CAPABILITY_REQUIREMENTS: Readonly<
  Record<LocalJobType, readonly LocalAgentCapability[]>
> = {
  deep_analysis: [
    "model_call", "structured_output", "repository_read", "symbol_search",
    "git_query", "structured_events", "cancellation",
  ],
  insight_evidence: [
    "model_call", "structured_output", "repository_read", "symbol_search",
    "git_query", "structured_events", "cancellation",
  ],
  repository_chat: [
    "model_call", "structured_output", "repository_read", "symbol_search",
    "git_query", "session_resume", "structured_events", "cancellation",
  ],
  managed_ai_task: [
    "model_call", "structured_output", "repository_read", "git_query",
    "structured_events", "cancellation",
  ],
  runner_check: [],
  repository_check: ["repository_read"],
  repository_clone: [],
  provider_refresh: ["model_call"],
  worktree_cleanup: ["worktree"],
};

export function requiredCapabilitiesForLocalJob(jobType: LocalJobType) {
  return LOCAL_JOB_CAPABILITY_REQUIREMENTS[jobType];
}

export function localJobTypeForAITask(taskKey: AITaskKey): LocalJobType {
  if (taskKey === "repository_code_chat") return "repository_chat";
  if (taskKey === "local_code_insight") return "insight_evidence";
  if (taskKey.endsWith("_deep_analysis")) return "deep_analysis";
  return "managed_ai_task";
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value: unknown) {
  if (typeof value !== "string" || !value) return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

export function localAgentEngineName(engine: LocalAgentEngine) {
  return LOCAL_AGENT_ENGINE_DEFINITIONS.find((definition) => definition.id === engine)?.name
    || engine;
}

export function isLocalAgentEngine(value: unknown): value is LocalAgentEngine {
  return typeof value === "string" && LOCAL_AGENT_ENGINES.includes(value as LocalAgentEngine);
}

export function localAgentEngineStates(row: Record<string, any> | null): LocalAgentEngineState[] {
  const rawCapabilities = jsonObject(row?.capabilities_json);
  const engineVersions = jsonObject(row?.engine_versions_json);
  const engineCatalogs = jsonObject(row?.engine_catalogs_json);
  const readonlyTools = new Set(array(rawCapabilities.readonlyTools).map(String));
  const common = new Set<LocalAgentCapability>();
  if (row?.readonly_verified) {
    common.add("repository_read");
    common.add("git_query");
    common.add("structured_output");
  }
  if ([...readonlyTools].some((tool) => ["grep", "glob", "lsp"].includes(tool))) {
    common.add("symbol_search");
  }
  if (rawCapabilities.worktrees) common.add("worktree");
  if (rawCapabilities.sessions) common.add("session_resume");
  if (rawCapabilities.events) common.add("structured_events");
  if (rawCapabilities.abort) common.add("cancellation");

  const engines = object(rawCapabilities.engines);
  return LOCAL_AGENT_ENGINE_DEFINITIONS.map(({ id }) => {
    const state = object(engines[id]);
    const catalog = object(engineCatalogs[id]);
    const available = state.available === true;
    return {
      engine: id,
      available,
      authenticated: state.authenticated === true,
      version: String(state.version || engineVersions[id] || ""),
      capabilities: [...new Set<LocalAgentCapability>([
        ...common,
        ...(available ? ["model_call" as const] : []),
        ...array(state.capabilities).filter((entry): entry is LocalAgentCapability =>
          LOCAL_AGENT_CAPABILITIES.includes(entry as LocalAgentCapability)),
      ])],
      permissionProfiles: array(state.permissionProfiles).map(String),
      providers: array(catalog.providers),
      models: array(catalog.models),
      error: typeof state.error === "string" ? state.error : null,
    };
  });
}

export function validateLocalAgentRuntime(input: {
  runner: Record<string, any> | null;
  engine: LocalAgentEngine;
  jobType: LocalJobType;
  permissionProfileId?: string;
  now?: number;
}) {
  if (!input.runner || !runnerIsOnline(input.runner.last_seen_at, input.now)) {
    return { ok: false as const, error: "本地分析 Runner 离线", missing: [] as LocalAgentCapability[] };
  }
  if (!input.runner.readonly_verified) {
    return { ok: false as const, error: "本地 Runner 尚未通过只读权限检查", missing: [] as LocalAgentCapability[] };
  }
  const engine = localAgentEngineStates(input.runner).find((state) => state.engine === input.engine)!;
  if (!engine.available) {
    return {
      ok: false as const,
      error: engine.error || `${localAgentEngineName(input.engine)} 引擎当前不可用`,
      missing: [] as LocalAgentCapability[],
    };
  }
  const required = requiredCapabilitiesForLocalJob(input.jobType);
  const available = new Set(engine.capabilities);
  const missing = required.filter((capability) => !available.has(capability));
  if (missing.length) {
    return {
      ok: false as const,
      error: `${localAgentEngineName(input.engine)} 缺少任务能力：${missing.join(", ")}`,
      missing,
    };
  }
  if (
    input.permissionProfileId &&
    !engine.permissionProfiles.includes(input.permissionProfileId)
  ) {
    return {
      ok: false as const,
      error: `${localAgentEngineName(input.engine)} 不支持权限档案 ${input.permissionProfileId}`,
      missing: [] as LocalAgentCapability[],
    };
  }
  return { ok: true as const, engine, missing: [] as LocalAgentCapability[] };
}

export function validateLocalAgentModelSelection(input: {
  state: LocalAgentEngineState;
  providerId?: string;
  modelId?: string;
  reasoningEffort?: string;
}) {
  const providers = input.state.providers as Array<Record<string, any>>;
  let models: Array<Record<string, any>>;
  if (providers.length) {
    const provider = input.providerId
      ? providers.find((candidate) => candidate.id === input.providerId)
      : providers[0];
    if (!provider) return { ok: false as const, error: "所选本地 Agent Provider 当前不可用" };
    models = array(provider.models);
  } else {
    models = input.state.models as Array<Record<string, any>>;
  }
  const model = input.modelId
    ? models.find((candidate) => candidate.id === input.modelId)
    : models.find((candidate) => candidate.isDefault) || models[0];
  if (!model) return { ok: false as const, error: "当前本地 Agent 没有可用模型" };
  if (input.reasoningEffort && !model.supportedReasoningEfforts?.some(
    (option: any) => option.reasoningEffort === input.reasoningEffort,
  )) {
    return { ok: false as const, error: "所选推理强度不受当前模型支持" };
  }
  return { ok: true as const };
}

export function isLocalJobType(value: unknown): value is LocalJobType {
  return typeof value === "string" && LOCAL_JOB_TYPES.includes(value as LocalJobType);
}

export function isTerminalLocalJobStatus(status: string) {
  return ["completed", "failed", "cancelled"].includes(status);
}

export function runnerIsOnline(lastSeenAt: string | null, now = Date.now()) {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).valueOf();
  return Number.isFinite(seen) && now - seen < 45_000;
}

function safeText(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeCodeReferences(
  value: unknown,
  allowed: Record<string, string>,
): CodeReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: any) => {
    const repository = entry?.repository === "vllm" || entry?.repository === "vllm-ascend"
      ? entry.repository
      : null;
    const expectedCommit = repository ? allowed[repository] : "";
    const commitSha = safeText(entry?.commitSha, 80);
    const path = safeText(entry?.path, 1_000).replace(/^\/+/, "");
    if (
      !repository ||
      !expectedCommit ||
      commitSha !== expectedCommit ||
      !path ||
      path.includes("..") ||
      path.startsWith(".env") ||
      path.includes("/.env")
    ) return [];
    const startLine = Number.isInteger(entry?.startLine) && entry.startLine > 0
      ? entry.startLine
      : null;
    const endLine = Number.isInteger(entry?.endLine) && entry.endLine >= (startLine || 1)
      ? entry.endLine
      : startLine;
    return [{
      repository,
      commitSha,
      path,
      symbol: safeText(entry?.symbol, 500) || "未指定符号",
      startLine,
      endLine,
      reason: safeText(entry?.reason, 1_000),
    }];
  }).slice(0, 200);
}

export function publicRunnerState(row: Record<string, any> | null, now = Date.now()) {
  const online = runnerIsOnline(row?.last_seen_at ?? null, now);
  const repositories = row?.repositories_json
    ? JSON.parse(row.repositories_json)
    : {};
  return {
    id: row?.id || null,
    online,
    status: online ? row?.status || "online" : "offline",
    version: row?.version || "",
    engineVersions: jsonObject(row?.engine_versions_json),
    engineCatalogs: jsonObject(row?.engine_catalogs_json),
    engines: localAgentEngineStates(row),
    authConfigured: Boolean(row?.auth_configured),
    readonlyVerified: Boolean(row?.readonly_verified),
    repositories,
    capabilities: row?.capabilities_json ? JSON.parse(row.capabilities_json) : {},
    activeJobs: Number(row?.active_jobs ?? 0),
    lastSeenAt: row?.last_seen_at ?? null,
    lastError: row?.last_error ?? null,
  };
}

export function eventLabel(input: {
  type: string;
  tool?: string;
  path?: string;
  query?: string;
  message?: string;
}) {
  const message = safeText(input.message, 500);
  if (message) return message;
  if (input.type === "file_read") return `[Read] ${safeText(input.path, 500)}`;
  if (input.type === "symbol_search") return `[Search] ${safeText(input.query, 500)}`;
  if (input.type === "git_query") return `[Git] ${safeText(input.query, 500)}`;
  if (input.type === "model_call") return "[Agent] 正在分析本地代码证据";
  if (input.type === "report_generate") return "[Agent] 正在整理最终报告";
  return "任务状态已更新";
}
