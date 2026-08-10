import type { WorkerEnv } from "../../db";
import {
  publicRunnerState,
  validateLocalAgentRuntime,
  type LocalAgentEngine,
  type LocalJobType,
} from "../../domain/local-analysis";
import { HttpError } from "../../http";
import {
  ensureLocalRunnerSettings,
  latestLocalRunner,
} from "../../repositories/local-runner";

export async function requireAvailableRunner(
  env: WorkerEnv,
  userId: string,
  engine: LocalAgentEngine,
  jobType: LocalJobType,
  permissionProfileId?: string,
) {
  const [settings, runner] = await Promise.all([
    ensureLocalRunnerSettings(env, userId),
    latestLocalRunner(env),
  ]);
  if (!settings?.enabled) {
    throw new HttpError(503, "本地分析 Runner 未启用，请先在设置中启用");
  }
  const validation = validateLocalAgentRuntime({ runner, engine, jobType, permissionProfileId });
  if (!validation.ok) throw new HttpError(503, validation.error);
  return { settings, runner, engine: validation.engine };
}

export async function localRunnerSettingsState(env: WorkerEnv, userId: string) {
  const [settings, runner] = await Promise.all([
    ensureLocalRunnerSettings(env, userId),
    latestLocalRunner(env),
  ]);
  return {
    settings: {
      enabled: Boolean(settings?.enabled),
      maxConcurrency: Number(settings?.max_concurrency ?? 1),
      worktreeRetentionHours: Number(settings?.worktree_retention_hours ?? 24),
      autoFetch: Boolean(settings?.auto_fetch),
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
    },
    runner: publicRunnerState(runner),
  };
}
