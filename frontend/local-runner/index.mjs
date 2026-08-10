import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadRunnerConfig, publicRepositoryConfig } from "./config.mjs";
import { createEngineRegistry } from "./engine-registry.mjs";
import { repositoryStates, runJob } from "./job-runner.mjs";
import { RunnerApi } from "./runner-api.mjs";
import { RunnerState } from "./runner-state.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstEngineError(status) {
  return Object.values(status.errors || {}).find(Boolean) || null;
}

async function main() {
  const config = loadRunnerConfig();
  mkdirSync(config.worktreeRoot, { recursive: true });
  mkdirSync(config.scratchRoot, { recursive: true });
  mkdirSync(dirname(config.statePath), { recursive: true });
  const api = new RunnerApi(config);
  const state = new RunnerState(config.statePath);
  const engines = await createEngineRegistry(config);
  const context = { config, api, state, engines };
  let stopped = false;
  let active = 0;
  let lastError = null;
  let effectiveMaxConcurrency = config.maxConcurrency;

  const stop = () => {
    stopped = true;
    engines.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const sendHeartbeat = async () => {
    try {
      const [engineStatus, repositories] = await Promise.all([
        engines.status(config.worktreeRoot),
        repositoryStates(config),
      ]);
      const engineError = firstEngineError(engineStatus);
      const heartbeat = await api.heartbeat({
        userId: config.userId,
        status: "online",
        version: config.version,
        engineVersions: engineStatus.engineVersions,
        engineCatalogs: engineStatus.engineCatalogs,
        readonlyVerified: engineStatus.readonlyVerified,
        repositories,
        capabilities: {
          sessions: true,
          events: true,
          abort: true,
          worktrees: true,
          readonlyTools: engineStatus.readonlyTools,
          engines: engineStatus.engines,
          repositoryConfig: publicRepositoryConfig(config),
        },
        activeJobs: active,
        lastError: engineError || lastError,
      });
      effectiveMaxConcurrency = Math.max(1, Math.min(Number(heartbeat?.policy?.maxConcurrency || config.maxConcurrency), 8));
      lastError = engineError;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  };

  await sendHeartbeat();
  let nextHeartbeat = Date.now() + config.heartbeatIntervalMs;
  while (!stopped) {
    if (Date.now() >= nextHeartbeat) {
      await sendHeartbeat();
      nextHeartbeat = Date.now() + config.heartbeatIntervalMs;
    }
    if (active < effectiveMaxConcurrency) {
      try {
        const job = await api.claim();
        if (job) {
          active += 1;
          runJob(job, context).catch((error) => {
            lastError = error instanceof Error ? error.message : String(error);
          }).finally(() => { active -= 1; });
          continue;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    await sleep(config.pollIntervalMs);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
