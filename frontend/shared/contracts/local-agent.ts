export const LOCAL_AGENT_ENGINE_DEFINITIONS = [
  {
    id: "opencode",
    name: "OpenCode",
    transport: "server-api",
    description: "通过本机 OpenCode Server 执行受控代码分析与隔离开发",
  },
  {
    id: "codex",
    name: "Codex",
    transport: "app-server",
    description: "通过本机 Codex App Server 执行只读代码分析",
  },
] as const;

export type LocalAgentEngine = (typeof LOCAL_AGENT_ENGINE_DEFINITIONS)[number]["id"];

export const LOCAL_AGENT_ENGINES: readonly LocalAgentEngine[] =
  LOCAL_AGENT_ENGINE_DEFINITIONS.map((definition) => definition.id);

export const LOCAL_AGENT_CAPABILITIES = [
  "model_call",
  "structured_output",
  "repository_read",
  "symbol_search",
  "git_query",
  "worktree",
  "session_resume",
  "structured_events",
  "cancellation",
] as const;

export type LocalAgentCapability = (typeof LOCAL_AGENT_CAPABILITIES)[number];

export type LocalAgentEngineState = {
  engine: LocalAgentEngine;
  available: boolean;
  authenticated: boolean;
  version: string;
  capabilities: LocalAgentCapability[];
  permissionProfiles: string[];
  providers: unknown[];
  models: unknown[];
  error: string | null;
};
