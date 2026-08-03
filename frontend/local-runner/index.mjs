import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { loadRunnerConfig, publicRepositoryConfig } from "./config.mjs";
import { JobEventStream } from "./event-normalizer.mjs";
import { GitWorktreeManager } from "./git-worktrees.mjs";
import { OpenCodeClient, sanitizeProviderResponse } from "./opencode-client.mjs";
import { buildRunnerPrompt, READ_ONLY_SYSTEM, validateStructuredResult } from "./prompts.mjs";
import { RunnerApi } from "./runner-api.mjs";
import { RunnerState } from "./runner-state.mjs";

const READ_ONLY_PERMISSIONS = [
  { permission: "*", pattern: "*", action: "deny" },
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "grep", pattern: "*", action: "allow" },
  { permission: "glob", pattern: "*", action: "allow" },
  { permission: "lsp", pattern: "*", action: "allow" },
  { permission: "read", pattern: "**/.env*", action: "deny" },
  { permission: "external_directory", pattern: "*", action: "deny" },
];

const READ_ONLY_TOOLS = {
  read: true,
  grep: true,
  glob: true,
  lsp: true,
  edit: false,
  write: false,
  apply_patch: false,
  patch: false,
  bash: false,
  shell: false,
  task: false,
  webfetch: false,
  websearch: false,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeRunnerError(value, config) {
  let message = String(value || "本地任务失败");
  for (const path of [config.worktreeRoot, ...Object.values(config.repositories)]) {
    if (path) message = message.split(String(path)).join("[local-path]");
  }
  return message
    .replace(/\/(?:Users|home|private|tmp)\/(?:[^\s:'\"]+\/?)+/g, "[local-path]")
    .slice(0, 2_000);
}

async function startManagedOpenCode(config) {
  const client = new OpenCodeClient(config);
  if (!config.manageOpenCodeServer) return { client, process: null };
  try {
    await client.health();
    return { client, process: null };
  } catch {
    // Start the configured local-only OpenCode server below.
  }
  const child = spawn("opencode", [
    "serve",
    "--hostname", "127.0.0.1",
    "--port", String(config.opencodePort),
    "--log-level", "WARN",
  ], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      OPENCODE_SERVER_USERNAME: config.opencodeUsername,
      OPENCODE_SERVER_PASSWORD: config.opencodePassword,
    },
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenCode Server 启动失败（退出码 ${child.exitCode}）`);
    try {
      await client.health();
      return { client, process: child };
    } catch {
      await sleep(500);
    }
  }
  child.kill("SIGTERM");
  throw new Error("OpenCode Server 30 秒内未就绪");
}

async function repositoryStates(config, emit = async () => {}) {
  const git = new GitWorktreeManager(config, emit);
  return {
    vllm: await git.status("vllm"),
    "vllm-ascend": await git.status("vllm-ascend"),
  };
}

async function specialJob(job, context) {
  const { config, opencode, events } = context;
  const git = new GitWorktreeManager(config, (...args) => events.emit(...args));
  if (job.jobType === "repository_clone") {
    const repository = job.repoScope;
    const state = await git.initialize(repository);
    return { repository, state };
  }
  if (job.jobType === "repository_check") {
    return { repositories: await repositoryStates(config, (...args) => events.emit(...args)) };
  }
  if (job.jobType === "worktree_cleanup") {
    return { removed: await git.cleanupExpired(Number(job.request?.worktreeRetentionHours || config.worktreeRetentionHours)) };
  }
  const health = await opencode.health();
  const providerResponse = await opencode.providers(config.worktreeRoot);
  return {
    healthy: health?.healthy === true,
    opencodeVersion: String(health?.version || ""),
    providers: sanitizeProviderResponse(providerResponse),
    repositories: job.jobType === "runner_check"
      ? await repositoryStates(config, (...args) => events.emit(...args))
      : undefined,
  };
}

async function getOrCreateSession(job, prepared, context, prompt) {
  const { opencode, state } = context;
  const directory = prepared.root;
  if (job.opencodeSessionId && prepared.reused) {
    try {
      await opencode.messages(job.opencodeSessionId, directory);
      const saved = state.session(job.opencodeSessionId);
      return {
        id: job.opencodeSessionId,
        directory,
        reused: true,
        sourceRead: Boolean(saved?.sourceRead),
      };
    } catch {
      state.removeSession(job.opencodeSessionId);
    }
  }
  const created = await opencode.createSession({
    directory,
    title: prompt.title,
    model: { providerID: job.providerId, modelID: job.modelId },
    permission: READ_ONLY_PERMISSIONS,
  });
  if (!created?.id) throw new Error("OpenCode 未返回 Session ID");
  state.saveSession(created.id, {
    root: prepared.root,
    worktrees: prepared.worktrees,
    commits: prepared.commits,
    sessionScope: job.sessionScope,
    sourceRead: false,
  });
  return { id: created.id, directory, reused: false, sourceRead: false };
}

async function analysisJob(job, context) {
  const { config, api, opencode, state, events } = context;
  const git = new GitWorktreeManager(config, (...args) => events.emit(...args));
  await events.emit("repository_prepare", "git", "正在准备本地仓库和分析版本");
  const prepared = await git.prepare(job, state);
  const gitEvidence = [];
  if (["vllm", "vllm-ascend"].includes(job.repoScope)) {
    const evidence = await git.gitEvidence(job.repoScope, job.baseSha, prepared.commits[job.repoScope]);
    if (evidence.length) {
      gitEvidence.push(...evidence);
      await events.emit("git_query", "git", `[Git] 已读取 ${job.repoScope} 版本差异和提交历史`, {
        repository: job.repoScope,
        commitSha: prepared.commits[job.repoScope],
      });
    }
  }
  const prompt = buildRunnerPrompt(job, prepared, gitEvidence);
  const session = await getOrCreateSession(job, prepared, context, prompt);
  await events.emit("model_call", "opencode", `[Agent] 正在使用 ${job.providerId || "默认 Provider"}/${job.modelId || "默认 Model"} 分析本地代码`, {
    providerId: job.providerId,
    modelId: job.modelId,
  });
  let result;
  try {
    const run = (message) => opencode.runStructured({
        sessionId: session.id,
        directory: session.directory,
        prompt: message,
        system: READ_ONLY_SYSTEM,
        model: { providerID: job.providerId, modelID: job.modelId },
        tools: READ_ONLY_TOOLS,
        schema: prompt.schema,
        timeoutMs: Math.max(60, Number(job.request?.timeoutSeconds || config.timeoutSeconds)) * 1_000,
        onEvent: (event) => events.opencode(event, prepared),
        shouldCancel: async () => (await api.status(job.id)) === "cancel_requested",
      });
    try {
      result = validateStructuredResult(await run(prompt.prompt), prompt.contentField);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isShapeError = message.startsWith("OpenCode 未返回结构化") ||
        message.startsWith("OpenCode 结构化输出缺少");
      if (!isShapeError) throw error;
      await events.emit(
        "warning",
        "opencode",
        "[Agent] 输出格式不符合约定，正在同一 Session 内纠正格式",
        { reason: message },
        "warning",
      );
      result = validateStructuredResult(await run(
        `上一条回复没有通过 LoongBoard 的结构校验：${message}。不要重新分析，也不要补充说明；请仅把已有结论整理为符合要求的 JSON 对象。`,
      ), prompt.contentField);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.runnerResult = {
      opencodeSessionId: session.id,
      resolvedCommits: prepared.commits,
      providerId: job.providerId,
      modelId: job.modelId,
    };
    throw failure;
  }
  await events.emit("report_generate", "opencode", "[Agent] 正在校验代码引用并生成最终报告");
  const codeReferences = git.validateReferences(result.codeReferences, prepared);
  const sourceRead = (events.sourceRead || session.sourceRead) && codeReferences.length > 0;
  state.saveSession(session.id, {
    root: prepared.root,
    worktrees: prepared.worktrees,
    commits: prepared.commits,
    sessionScope: job.sessionScope,
    sourceRead,
  });
  return {
    ...result,
    codeReferences,
    sourceRead,
    opencodeSessionId: session.id,
    resolvedCommits: prepared.commits,
    providerId: job.providerId,
    modelId: job.modelId,
  };
}

async function runJob(job, context) {
  const events = new JobEventStream(context.api, job.id);
  const scoped = { ...context, events };
  await context.api.running(job.id);
  await events.emit("task_started", "runner", "任务已由本地 Runner 接收", { status: "running" });
  try {
    const actionTypes = new Set([
      "runner_check", "repository_check", "repository_clone", "provider_refresh", "worktree_cleanup",
    ]);
    const result = actionTypes.has(job.jobType)
      ? await specialJob(job, scoped)
      : await analysisJob(job, scoped);
    await events.emit("task_completed", "runner", "[Result] 本地任务已完成", { status: "completed" });
    await context.api.complete(job.id, "completed", result, null);
  } catch (error) {
    const cancelled = error?.code === "CANCELLED";
    const message = sanitizeRunnerError(error instanceof Error ? error.message : String(error), context.config);
    await events.emit(cancelled ? "warning" : "error", "runner", cancelled ? "任务已取消" : `任务失败：${message}`, {}, cancelled ? "warning" : "error").catch(() => {});
    await context.api.complete(
      job.id,
      cancelled ? "cancelled" : "failed",
      error?.runnerResult || {},
      message,
    ).catch(() => {});
  }
}

async function main() {
  const config = loadRunnerConfig();
  mkdirSync(config.worktreeRoot, { recursive: true });
  mkdirSync(dirname(config.statePath), { recursive: true });
  const api = new RunnerApi(config);
  const state = new RunnerState(config.statePath);
  const managed = await startManagedOpenCode(config);
  const context = { config, api, state, opencode: managed.client };
  let stopped = false;
  let active = 0;
  let lastError = null;
  let providerCache = [];
  let heartbeatVersion = "";
  let effectiveMaxConcurrency = config.maxConcurrency;

  const stop = () => {
    stopped = true;
    managed.process?.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const sendHeartbeat = async () => {
    try {
      const health = await managed.client.health();
      heartbeatVersion = String(health?.version || "");
      const providers = await managed.client.providers(config.worktreeRoot);
      providerCache = sanitizeProviderResponse(providers);
      const repositories = await repositoryStates(config);
      const heartbeat = await api.heartbeat({
        userId: config.userId,
        status: "online",
        version: config.version,
        opencodeVersion: heartbeatVersion,
        authConfigured: Boolean(config.opencodePassword),
        readonlyVerified: true,
        repositories,
        providers: providerCache,
        capabilities: {
          sessions: true,
          events: true,
          abort: true,
          worktrees: true,
          readonlyTools: Object.keys(READ_ONLY_TOOLS).filter((key) => READ_ONLY_TOOLS[key]),
          repositoryConfig: publicRepositoryConfig(config),
        },
        activeJobs: active,
        lastError,
      });
      effectiveMaxConcurrency = Math.max(1, Math.min(Number(heartbeat?.policy?.maxConcurrency || config.maxConcurrency), 8));
      lastError = null;
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
