import { spawn } from "node:child_process";
import { normalizeOpenCodeEvent } from "../event-normalizer.mjs";
import { OpenCodeClient, sanitizeProviderResponse } from "../opencode-client.mjs";
import {
  commonCapabilities,
  agentSessionResult,
  requestedSessionId,
} from "./contracts.mjs";
import { permissionProfile } from "../permission-profiles.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenCodeEngineAdapter {
  constructor(config, client = new OpenCodeClient(config)) {
    this.id = "opencode";
    this.name = "OpenCode";
    this.config = config;
    this.client = client;
    this.process = null;
    this.startupError = null;
    this.enabled = config.engines.opencode.enabled !== false;
    this.authConfigured = Boolean(config.engines.opencode.password);
    const safeProfile = permissionProfile("safe_readonly");
    this.capabilities = commonCapabilities({
      providers: true,
      reasoningEffort: false,
      permissionProfiles: ["safe_readonly", "community_research", "worktree_development"]
        .filter((profile) => config.allowedPermissionProfiles.includes(profile)),
      readonlyTools: Object.keys(safeProfile.tools).filter((key) => safeProfile.tools[key]),
    });
  }

  async initialize() {
    if (!this.enabled || !this.config.engines.opencode.manageServer) return;
    try {
      await this.client.health();
      return;
    } catch {
      // Start the configured loopback-only OpenCode server below.
    }
    const child = spawn("opencode", [
      "serve",
      "--hostname", "127.0.0.1",
      "--port", String(this.config.engines.opencode.port),
      "--log-level", "WARN",
    ], {
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        OPENCODE_SERVER_USERNAME: this.config.engines.opencode.username,
        OPENCODE_SERVER_PASSWORD: this.config.engines.opencode.password,
        OPENCODE_CONFIG: this.config.engines.opencode.configPath,
        OPENCODE_CONFIG_DIR: this.config.engines.opencode.configDir,
      },
    });
    this.process = child;
    let spawnError = null;
    child.once("error", (error) => { spawnError = error; });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`OpenCode Server 启动失败（退出码 ${child.exitCode}）`);
      try {
        await this.client.health();
        return;
      } catch {
        await sleep(500);
      }
    }
    child.kill("SIGTERM");
    throw new Error("OpenCode Server 30 秒内未就绪");
  }

  async health() {
    if (!this.enabled) {
      return {
        healthy: false,
        available: false,
        authenticated: false,
        version: "",
        error: "OpenCode 已在本地 Runner 配置中关闭",
      };
    }
    const health = await this.client.health();
    if (health?.healthy === true) this.startupError = null;
    return {
      healthy: health?.healthy === true,
      available: health?.healthy === true,
      authenticated: Boolean(this.config.engines.opencode.password),
      version: String(health?.version || ""),
    };
  }

  async catalog(directory) {
    const providers = sanitizeProviderResponse(await this.client.providers(directory));
    return {
      providers,
      models: providers.flatMap((provider) => provider.models.map((model) => ({
        ...model,
        providerId: provider.id,
      }))),
    };
  }

  async openSession({ job, prepared, prompt, state, policy }) {
    const directory = prepared.root;
    const requested = requestedSessionId(job);
    if (requested && prepared.reused) {
      try {
        await this.history({ id: requested, directory });
        const saved = state.session(requested);
        return {
          id: requested,
          directory,
          reused: true,
          sourceRead: Boolean(saved?.sourceRead),
        };
      } catch {
        state.removeSession(requested);
      }
    }
    const created = await this.client.createSession({
      directory,
      title: prompt.title,
      model: { providerID: job.providerId, modelID: job.modelId },
      permission: policy.permissions,
    });
    if (!created?.id) throw new Error("OpenCode 未返回 Session ID");
    return { id: created.id, directory, reused: false, sourceRead: false };
  }

  history(session) {
    return this.client.messages(session.id, session.directory);
  }

  async runStructured(input) {
    const result = await this.client.runStructured({
      sessionId: input.session.id,
      directory: input.session.directory,
      prompt: input.message,
      system: input.system,
      model: { providerID: input.job.providerId, modelID: input.job.modelId },
      tools: input.policy.tools,
      schema: input.schema,
      timeoutMs: input.timeoutMs,
      onEvent: input.onEvent,
      shouldCancel: input.shouldCancel,
    });
    return { result, sessionId: input.session.id };
  }

  cancel(session) {
    return this.client.abort(session.id, session.directory);
  }

  normalizeEvent(event, prepared) {
    return normalizeOpenCodeEvent(event, prepared);
  }

  modelCall(job) {
    return {
      message: `[Agent] 正在使用 ${job.providerId || "默认 Provider"}/${job.modelId || "默认 Model"} 分析本地代码`,
      metadata: { providerId: job.providerId, modelId: job.modelId },
    };
  }

  resultMetadata(job, sessionId) {
    return {
      ...agentSessionResult(sessionId),
      engineId: this.id,
      providerId: job.providerId,
      modelId: job.modelId,
    };
  }

  stop() {
    this.process?.kill("SIGTERM");
  }
}
