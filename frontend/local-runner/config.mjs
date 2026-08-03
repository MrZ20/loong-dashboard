import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const dashboardRoot = resolve(moduleDir, "../..");

function resolveLocalPath(value, fallback) {
  const candidate = value || fallback;
  return resolve(dashboardRoot, candidate);
}

function readLocalConfig(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`本地 Runner 配置无法读取：${error instanceof Error ? error.message : String(error)}`);
  }
}

function numberValue(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(number, max)) : fallback;
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "off", "no"].includes(String(value).toLowerCase());
}

export function loadRunnerConfig(env = process.env) {
  const configPath = env.LOONGBOARD_RUNNER_CONFIG || resolve(dashboardRoot, ".loongboard/runner.json");
  const file = readLocalConfig(configPath);
  const opencodePort = numberValue(env.OPENCODE_PORT || file.opencodePort, 4096, 1, 65_535);
  const generatedPassword = randomBytes(24).toString("base64url");
  const repositories = {
    vllm: resolveLocalPath(env.VLLM_REPOSITORY_PATH || file.repositories?.vllm, "../vllm"),
    "vllm-ascend": resolveLocalPath(
      env.VLLM_ASCEND_REPOSITORY_PATH || file.repositories?.["vllm-ascend"], "../vllm-ascend",
    ),
  };
  return {
    version: "1.0.0",
    runnerId: env.LOONGBOARD_RUNNER_ID || file.runnerId || `local-${hostname()}`,
    userId: env.LOONGBOARD_RUNNER_USER_ID || file.userId || "",
    dashboardUrl: String(env.LOONGBOARD_URL || file.dashboardUrl || "http://127.0.0.1:4174").replace(/\/+$/, ""),
    runnerToken: env.LOONGBOARD_RUNNER_TOKEN || file.runnerToken || "",
    repositories,
    worktreeRoot: resolveLocalPath(env.LOONGBOARD_WORKTREE_ROOT || file.worktreeRoot, ".loongboard/worktrees"),
    statePath: resolveLocalPath(env.LOONGBOARD_RUNNER_STATE || file.statePath, ".loongboard/runner-state.json"),
    opencodeUrl: String(env.OPENCODE_URL || file.opencodeUrl || `http://127.0.0.1:${opencodePort}`).replace(/\/+$/, ""),
    opencodePort,
    opencodeUsername: env.OPENCODE_SERVER_USERNAME || file.opencodeUsername || "opencode",
    opencodePassword: env.OPENCODE_SERVER_PASSWORD || file.opencodePassword || generatedPassword,
    manageOpenCodeServer: booleanValue(env.MANAGE_OPENCODE_SERVER ?? file.manageOpenCodeServer, true),
    maxConcurrency: numberValue(env.LOONGBOARD_MAX_CONCURRENCY || file.maxConcurrency, 1, 1, 8),
    pollIntervalMs: numberValue(env.LOONGBOARD_POLL_INTERVAL_MS || file.pollIntervalMs, 1_500, 250, 30_000),
    heartbeatIntervalMs: numberValue(env.LOONGBOARD_HEARTBEAT_MS || file.heartbeatIntervalMs, 10_000, 2_000, 60_000),
    worktreeRetentionHours: numberValue(env.LOONGBOARD_WORKTREE_RETENTION_HOURS || file.worktreeRetentionHours, 24, 1, 720),
    autoFetch: booleanValue(env.LOONGBOARD_AUTO_FETCH ?? file.autoFetch, true),
    timeoutSeconds: numberValue(env.LOONGBOARD_TIMEOUT_SECONDS || file.timeoutSeconds, 900, 60, 7_200),
    cloneUrls: {
      vllm: file.cloneUrls?.vllm || "https://github.com/vllm-project/vllm.git",
      "vllm-ascend": file.cloneUrls?.["vllm-ascend"] || "https://github.com/vllm-project/vllm-ascend.git",
    },
  };
}

export function publicRepositoryConfig(config) {
  return Object.fromEntries(Object.keys(config.repositories).map((repository) => [
    repository,
    { configured: Boolean(config.repositories[repository]) },
  ]));
}
