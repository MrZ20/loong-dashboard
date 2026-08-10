import { JobEventStream } from "./event-normalizer.mjs";
import { sanitizeRunnerError } from "./errors.mjs";
import { WorkspaceManager } from "./git-worktrees.mjs";
import { runAnalysisJob } from "./analysis-job.mjs";

const ACTION_JOB_TYPES = new Set([
  "runner_check",
  "repository_check",
  "repository_clone",
  "provider_refresh",
  "worktree_cleanup",
]);

export async function repositoryStates(config, emit = async () => {}) {
  const git = new WorkspaceManager(config, emit);
  return {
    vllm: await git.status("vllm"),
    "vllm-ascend": await git.status("vllm-ascend"),
  };
}

export async function runActionJob(job, context) {
  const { config, engines, events } = context;
  const git = new WorkspaceManager(config, (...args) => events.emit(...args));
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
  const status = await engines.status(config.worktreeRoot);
  return {
    ...status,
    repositories: job.jobType === "runner_check"
      ? await repositoryStates(config, (...args) => events.emit(...args))
      : undefined,
  };
}

export async function runJob(job, context) {
  const events = new JobEventStream(context.api, job.id);
  const scoped = { ...context, events };
  await context.api.running(job.id);
  await events.emit("task_started", "runner", "任务已由本地 Runner 接收", { status: "running" });
  try {
    const result = ACTION_JOB_TYPES.has(job.jobType)
      ? await runActionJob(job, scoped)
      : await runAnalysisJob(job, scoped);
    await events.emit("task_completed", "runner", "[Result] 本地任务已完成", { status: "completed" });
    await context.api.complete(job.id, "completed", result, null);
  } catch (error) {
    const cancelled = error?.code === "CANCELLED";
    const message = sanitizeRunnerError(error instanceof Error ? error.message : String(error), context.config);
    await events.emit(
      cancelled ? "warning" : "error",
      "runner",
      cancelled ? "任务已取消" : `任务失败：${message}`,
      {},
      cancelled ? "warning" : "error",
    ).catch(() => {});
    await context.api.complete(
      job.id,
      cancelled ? "cancelled" : "failed",
      error?.runnerResult || {},
      message,
    ).catch(() => {});
  }
}
