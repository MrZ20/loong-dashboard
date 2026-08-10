import {
  LOCAL_AGENT_ENGINE_DEFINITIONS,
  type LocalAgentEngine,
  type LocalAgentEngineState,
} from "../../shared/contracts/local-agent";
import type { AIExecutionMode } from "../types/ai";
import type { LocalExecutionEngineCapability, LocalRunnerSettingsState } from "../types/analysis";

export interface AIExecutionEngineDefinition {
  id: AIExecutionMode;
  name: string;
  description: string;
  requiresLocalRunner: boolean;
  capabilityId: LocalExecutionEngineCapability["id"] | null;
}

const API_EXECUTION_ENGINE: AIExecutionEngineDefinition = {
  id: "api",
  name: "API 配置",
  description: "直连 OpenAI-compatible 接口",
  requiresLocalRunner: false,
  capabilityId: null,
};

export const AI_EXECUTION_ENGINES: readonly AIExecutionEngineDefinition[] = [
  API_EXECUTION_ENGINE,
  ...LOCAL_AGENT_ENGINE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    requiresLocalRunner: true,
    capabilityId: definition.id,
  })),
];

export function executionEngineDefinition(mode: AIExecutionMode) {
  return AI_EXECUTION_ENGINES.find((engine) => engine.id === mode) ?? API_EXECUTION_ENGINE;
}

export type LocalAgentModelOption = {
  id: string;
  name: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
};

export type LocalAgentProviderOption = {
  id: string;
  name: string;
  models: LocalAgentModelOption[];
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function reasoningEffortOption(value: unknown) {
  const candidate = object(value);
  const reasoningEffort = typeof candidate.reasoningEffort === "string" ? candidate.reasoningEffort : "";
  if (!reasoningEffort) return null;
  return {
    reasoningEffort,
    description: typeof candidate.description === "string" ? candidate.description : "",
  };
}

function modelOption(value: unknown): LocalAgentModelOption | null {
  const candidate = object(value);
  const id = typeof candidate.id === "string" ? candidate.id : "";
  if (!id) return null;
  return {
    id,
    name: typeof candidate.name === "string" ? candidate.name : id,
    isDefault: candidate.isDefault === true,
    defaultReasoningEffort: typeof candidate.defaultReasoningEffort === "string"
      ? candidate.defaultReasoningEffort
      : "",
    supportedReasoningEfforts: Array.isArray(candidate.supportedReasoningEfforts)
      ? candidate.supportedReasoningEfforts
          .map(reasoningEffortOption)
          .filter((option): option is { reasoningEffort: string; description: string } => Boolean(option))
      : [],
  };
}

function providerOption(value: unknown): LocalAgentProviderOption | null {
  const candidate = object(value);
  const id = typeof candidate.id === "string" ? candidate.id : "";
  if (!id) return null;
  return {
    id,
    name: typeof candidate.name === "string" ? candidate.name : id,
    models: Array.isArray(candidate.models)
      ? candidate.models.map(modelOption).filter((model): model is LocalAgentModelOption => Boolean(model))
      : [],
  };
}

export function selectedLocalEngineState(
  runner: LocalRunnerSettingsState["runner"],
  engineId: AIExecutionMode,
): LocalAgentEngineState | null {
  if (engineId === "api") return null;
  return runner.engines.find((state) => state.engine === engineId) ?? null;
}

export function localAgentProviders(state: LocalAgentEngineState | null): LocalAgentProviderOption[] {
  return (state?.providers ?? [])
    .map(providerOption)
    .filter((provider): provider is LocalAgentProviderOption => Boolean(provider));
}

export function localAgentModels(state: LocalAgentEngineState | null): LocalAgentModelOption[] {
  return (state?.models ?? [])
    .map(modelOption)
    .filter((model): model is LocalAgentModelOption => Boolean(model));
}

export function localExecutionEngineCapabilities(
  runner: LocalRunnerSettingsState["runner"],
): LocalExecutionEngineCapability[] {
  function status(available: boolean) {
    return !runner.online ? "offline" as const : available ? "ready" as const : "unavailable" as const;
  }

  function label(available: boolean, authenticated: boolean) {
    if (!runner.online) return "Runner 离线";
    if (!available) return "不可用";
    return authenticated ? "可用 · 已认证" : "可用 · 未配置认证";
  }

  return LOCAL_AGENT_ENGINE_DEFINITIONS.map((definition) => {
    const state = runner.engines.find((candidate) => candidate.engine === definition.id);
    const available = runner.online && Boolean(state?.available);
    const providers = localAgentProviders(state ?? null);
    const models = localAgentModels(state ?? null);
    return {
      id: definition.id as LocalAgentEngine,
      name: definition.name,
      transport: definition.transport,
      available,
      authenticated: Boolean(state?.authenticated),
      status: status(available),
      statusLabel: label(available, Boolean(state?.authenticated)),
      version: state?.version || runner.engineVersions[definition.id] || null,
      modelCount: providers.length
        ? providers.reduce((count, provider) => count + provider.models.length, 0)
        : models.length,
      error: state?.error ?? null,
    };
  });
}
