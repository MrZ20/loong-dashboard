import { CodexEngineAdapter } from "./engines/codex-adapter.mjs";
import { assertEngineAdapter, requestedEngineId } from "./engines/contracts.mjs";
import { OpenCodeEngineAdapter } from "./engines/opencode-adapter.mjs";
import { sanitizeRunnerError } from "./errors.mjs";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class EngineRegistry {
  constructor(adapters, options = {}) {
    this.adapters = new Map();
    this.sanitizeError = options.sanitizeError || ((value) => value);
    for (const adapter of adapters) {
      const valid = assertEngineAdapter(adapter);
      if (this.adapters.has(valid.id)) throw new Error(`本地分析引擎 ID 重复：${valid.id}`);
      this.adapters.set(valid.id, valid);
    }
  }

  list() {
    return [...this.adapters.values()];
  }

  get(engineId) {
    const adapter = this.adapters.get(String(engineId || ""));
    if (!adapter) throw new Error(`本地 Runner 不支持执行引擎 ${String(engineId || "")}`);
    if (adapter.enabled === false) throw new Error(`本地 Runner 已关闭执行引擎 ${adapter.name}`);
    return adapter;
  }

  forJob(job) {
    return this.get(requestedEngineId(job));
  }

  async describe(directory) {
    return Promise.all(this.list().map(async (adapter) => {
      let health;
      let catalog = { providers: [], models: [] };
      try {
        health = await adapter.health(directory);
        if (health.available !== false) catalog = await adapter.catalog(directory);
      } catch (error) {
        health = {
          healthy: false,
          available: false,
          authenticated: false,
          version: "",
          error: errorMessage(error),
        };
      }
      return {
        id: adapter.id,
        name: adapter.name,
        enabled: adapter.enabled !== false,
        healthy: health.healthy === true,
        available: health.available === true,
        authenticated: health.authenticated === true,
        authConfigured: adapter.authConfigured === true || health.authenticated === true,
        version: String(health.version || ""),
        providers: catalog.providers || [],
        models: catalog.models || [],
        capabilities: adapter.capabilities,
        error: health.error || adapter.startupError
          ? this.sanitizeError(health.error || adapter.startupError)
          : null,
        authMode: health.authMode || null,
      };
    }));
  }

  async status(directory) {
    const descriptions = await this.describe(directory);
    return {
      engines: Object.fromEntries(descriptions.map((engine) => [engine.id, {
        ...engine,
        capabilities: engine.capabilities?.features || [],
        permissionProfiles: engine.capabilities?.permissionProfiles || [],
      }])),
      engineVersions: Object.fromEntries(descriptions.map((engine) => [engine.id, engine.version || ""])),
      engineCatalogs: Object.fromEntries(descriptions.map((engine) => [engine.id, {
        providers: engine.providers,
        models: engine.models,
      }])),
      readonlyTools: [...new Set(descriptions.flatMap((engine) => engine.capabilities?.readonlyTools || []))],
      readonlyVerified: descriptions
        .filter((engine) => engine.enabled)
        .every((engine) => engine.capabilities?.defaultReadOnly === true),
      errors: Object.fromEntries(descriptions.filter((engine) => engine.error).map((engine) => [engine.id, engine.error])),
    };
  }

  stop() {
    for (const adapter of this.list()) adapter.stop();
  }
}

export async function createEngineRegistry(config, clients = {}) {
  const opencode = new OpenCodeEngineAdapter(config, clients.opencode);
  try {
    await opencode.initialize();
  } catch (error) {
    opencode.startupError = errorMessage(error);
  }
  const codex = new CodexEngineAdapter(config, clients.codex);
  return new EngineRegistry([opencode, codex], {
    sanitizeError: (value) => sanitizeRunnerError(value, config),
  });
}
