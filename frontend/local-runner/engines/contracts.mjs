const REQUIRED_METHODS = Object.freeze([
  "health",
  "catalog",
  "openSession",
  "history",
  "runStructured",
  "cancel",
  "normalizeEvent",
  "modelCall",
  "resultMetadata",
  "stop",
]);

export function assertEngineAdapter(adapter) {
  if (!adapter || typeof adapter.id !== "string" || !adapter.id.trim()) {
    throw new Error(`未知本地分析引擎：${String(adapter?.id || "")}`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`本地分析引擎 ${adapter.id} 缺少 ${method}() 实现`);
    }
  }
  if (!adapter.capabilities || adapter.capabilities.defaultReadOnly !== true) {
    throw new Error(`本地分析引擎 ${adapter.id} 未声明默认安全边界`);
  }
  return adapter;
}

export function requestedEngineId(job) {
  const engineId = String(job?.engineId || "").trim();
  if (!engineId) throw new Error("本地分析任务缺少 engineId");
  return engineId;
}

export function requestedSessionId(job) {
  return String(job?.agentSessionId || "");
}

export function agentSessionResult(sessionId) {
  return { agentSessionId: sessionId || "" };
}

export function commonCapabilities(overrides = {}) {
  return Object.freeze({
    sessions: true,
    history: true,
    events: true,
    cancel: true,
    structuredOutput: true,
    defaultReadOnly: true,
    policyControlled: true,
    worktrees: true,
    formatCorrection: true,
    features: [
      "repository_read",
      "symbol_search",
      "git_query",
      "structured_output",
      "worktree",
      "session_resume",
      "structured_events",
      "cancellation",
    ],
    ...overrides,
  });
}
