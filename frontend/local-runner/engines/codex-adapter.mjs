import { CodexClient } from "../codex-client.mjs";
import { normalizeCodexEvent } from "../event-normalizer.mjs";
import {
  commonCapabilities,
  agentSessionResult,
  requestedSessionId,
} from "./contracts.mjs";

export class CodexEngineAdapter {
  constructor(config, client = new CodexClient(config)) {
    this.id = "codex";
    this.name = "Codex";
    this.config = config;
    this.client = client;
    this.enabled = config.engines.codex.enabled !== false;
    this.capabilities = commonCapabilities({
      providers: false,
      reasoningEffort: true,
      permissionProfiles: config.allowedPermissionProfiles.includes("safe_readonly")
        ? ["safe_readonly"]
        : [],
      readonlyTools: ["read", "search", "git-query", "lsp"],
    });
  }

  async health() {
    if (!this.enabled) {
      return {
        healthy: false,
        available: false,
        authenticated: false,
        version: "",
        error: "Codex 已在本地 Runner 配置中关闭",
      };
    }
    const health = await this.client.health();
    return {
      ...health,
      healthy: health.available === true && health.authenticated === true,
      version: String(health.version || ""),
    };
  }

  async catalog() {
    if (!this.enabled) return { providers: [], models: [] };
    const health = await this.client.health();
    return { providers: [], models: health.models || [] };
  }

  async openSession({ job, prepared, state, policy }) {
    if (policy.id !== "safe_readonly") throw new Error("Codex 当前只支持安全只读权限档案");
    const requested = prepared.reused ? requestedSessionId(job) : "";
    const saved = requested ? state.session(requested) : null;
    return {
      id: requested,
      directory: prepared.root,
      reused: Boolean(requested),
      sourceRead: Boolean(saved?.sourceRead),
    };
  }

  history(session) {
    if (!session.id) return Promise.resolve([]);
    return this.client.history(session.id);
  }

  runStructured(input) {
    if (input.policy.id !== "safe_readonly") throw new Error("Codex 当前只支持安全只读权限档案");
    const effort = String(input.job.request?.reasoningEffort || "") || null;
    return this.client.runStructured({
      sessionId: input.session.id,
      directory: input.session.directory,
      prompt: input.message,
      system: input.system,
      model: input.job.modelId || null,
      effort,
      schema: input.schema,
      timeoutMs: input.timeoutMs,
      onEvent: input.onEvent,
      shouldCancel: input.shouldCancel,
    });
  }

  cancel(session) {
    return this.client.cancel(session.id);
  }

  normalizeEvent(event, prepared) {
    return normalizeCodexEvent(event, prepared);
  }

  modelCall(job) {
    const reasoningEffort = String(job.request?.reasoningEffort || "");
    return {
      message: `[Agent] 正在使用 Codex/${job.modelId || "默认模型"}${reasoningEffort ? ` · ${reasoningEffort}` : ""} 分析本地代码`,
      metadata: {
        providerId: "openai",
        modelId: job.modelId,
        reasoningEffort,
      },
    };
  }

  resultMetadata(job, sessionId) {
    const reasoningEffort = String(job.request?.reasoningEffort || "");
    return {
      ...agentSessionResult(sessionId),
      engineId: this.id,
      providerId: "openai",
      modelId: job.modelId,
      reasoningEffort,
    };
  }

  stop() {
    this.client.stop();
  }
}
