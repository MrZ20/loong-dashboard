import type { WorkerEnv } from "../db";
import {
  REFRESH_DEFAULTS,
  isRefreshTaskType,
  type RefreshRule,
  type RefreshTaskType,
} from "../domain/refresh-policy";
import { HttpError } from "../http";
import {
  beginRefreshTaskRun,
  claimRefreshTaskRun,
  completeRefreshTaskRun,
  countPendingRefreshItems,
  ensureRefreshTaskConfigs,
  failRefreshTaskRun,
  findRefreshTaskConfig,
  findQueuedRefreshTaskRun,
  listDueRefreshTaskConfigs,
  listQueuedRefreshTaskRuns,
  listRefreshTaskConfigs,
  requeueExpiredRefreshRuns,
  updateRefreshTaskConfig,
  type RefreshTaskConfigRow,
} from "../repositories/refresh-tasks";
import {
  getRefreshTaskDefinition,
  getRefreshTaskHandler,
} from "./refresh-handlers/registry";
import type { RefreshTaskRequest } from "./refresh-handlers/types";

function mapRefreshTaskState(row: RefreshTaskConfigRow, pendingCount: number) {
  const now = Date.now();
  const next = row.next_scheduled_at
    ? new Date(row.next_scheduled_at).valueOf()
    : null;
  return {
    repoId: row.repo_id,
    taskType: row.task_type,
    autoEnabled: Boolean(row.auto_enabled),
    intervalMinutes: row.interval_minutes,
    activeRangeHours: Number(row.active_range_hours),
    refreshRule: row.refresh_rule,
    maxItems: Number(row.max_items),
    includeCiChanges: Boolean(row.include_ci_changes),
    includeCommentChanges: Boolean(row.include_comment_changes),
    stateFilter: row.state_filter || "all",
    domainFilter: row.domain_filter || "all",
    status: row.status,
    lastAttemptedAt: row.last_attempted_at,
    lastSuccessfulAt: row.last_successful_at,
    watermarkUpdatedAt: row.watermark_updated_at,
    nextScheduledAt: row.next_scheduled_at,
    lastError: row.last_error,
    currentStage: row.current_stage || "idle",
    progressCurrent: Number(row.progress_current ?? 0),
    progressTotal: Number(row.progress_total ?? 0),
    pendingCount,
    stale: row.status === "failed" ||
      (row.task_type !== "deep_analysis" && pendingCount > 0) ||
      (Boolean(row.auto_enabled) && next !== null && next <= now) ||
      (!row.last_successful_at && row.task_type !== "deep_analysis"),
  };
}

export async function listRefreshSettings(env: WorkerEnv, userId: string) {
  await ensureRefreshTaskConfigs(env, userId);
  const rows = await listRefreshTaskConfigs(env, userId);
  return Promise.all(rows.map(async (row) => {
    const pending = await countPendingRefreshItems(env, {
      repoId: row.repo_id,
      taskType: row.task_type,
      refreshRule: row.refresh_rule,
      activeRangeHours: Number(row.active_range_hours),
      stateFilter: row.state_filter || "all",
      domainFilter: row.domain_filter || "all",
    });
    return mapRefreshTaskState(row, Number(pending?.count ?? 0));
  }));
}

export async function saveRefreshSettings(
  env: WorkerEnv,
  userId: string,
  repoId: string,
  taskType: RefreshTaskType,
  input: Partial<{
    autoEnabled: boolean;
    intervalMinutes: number | null;
    activeRangeHours: number;
    refreshRule: RefreshRule;
    maxItems: number;
    includeCiChanges: boolean;
    includeCommentChanges: boolean;
    stateFilter: "all" | "open" | "draft" | "merged" | "closed";
    domainFilter: string;
  }>,
) {
  await ensureRefreshTaskConfigs(env, userId);
  const current = await findRefreshTaskConfig(env, userId, repoId, taskType);
  if (!current) throw new HttpError(404, "刷新配置不存在");
  const defaults = REFRESH_DEFAULTS[taskType];
  const definition = getRefreshTaskDefinition(taskType);
  const intervalMinutes = input.intervalMinutes === null
    ? null
    : Math.min(Math.max(Number(input.intervalMinutes ?? current.interval_minutes ?? defaults.intervalMinutes ?? 60), 15), 43_200);
  const activeRangeHours = Math.min(
    Math.max(Number(input.activeRangeHours ?? current.active_range_hours), 24),
    2_160,
  );
  const maxItems = Math.min(Math.max(Number(input.maxItems ?? current.max_items), 1), 500);
  const candidateRule = input.refreshRule ?? current.refresh_rule;
  const refreshRule = definition.allowedRules.includes(candidateRule)
    ? candidateRule
    : defaults.refreshRule;
  const allowedStates = ["all", "open", "draft", "merged", "closed"] as const;
  const requestedState = input.stateFilter ?? current.state_filter ?? "all";
  const stateFilter = definition.supportsFilters && allowedStates.includes(requestedState)
    ? requestedState
    : "all";
  const requestedDomain = String(input.domainFilter ?? current.domain_filter ?? "all").trim();
  const domainFilter = definition.supportsFilters && requestedDomain
    ? requestedDomain.slice(0, 120)
    : "all";
  await updateRefreshTaskConfig(env, userId, repoId, taskType, {
    autoEnabled: !definition.supportsAutomatic || refreshRule === "manual"
      ? false
      : Boolean(input.autoEnabled ?? current.auto_enabled),
    intervalMinutes: definition.supportsInterval ? intervalMinutes : null,
    activeRangeHours,
    refreshRule,
    maxItems,
    includeCiChanges: definition.supportsSummaryChangeFlags && Boolean(
      input.includeCiChanges ?? current.include_ci_changes,
    ),
    includeCommentChanges: definition.supportsSummaryChangeFlags && Boolean(
      input.includeCommentChanges ?? current.include_comment_changes,
    ),
    stateFilter,
    domainFilter,
  });
  const tasks = await listRefreshSettings(env, userId);
  return tasks.find(
    (task) => task.repoId === repoId && task.taskType === taskType,
  )!;
}

export async function runRefreshTask(
  env: WorkerEnv,
  input: RefreshTaskRequest,
) {
  await ensureRefreshTaskConfigs(env, input.userId);
  const config = await findRefreshTaskConfig(
    env,
    input.userId,
    input.repoId,
    input.taskType,
  );
  if (!config) throw new HttpError(404, "刷新配置不存在");
  if (["queued", "running"].includes(config.status)) {
    throw new HttpError(409, "该刷新任务已在队列中或正在运行");
  }
  const priority = input.itemId ? "high" : "normal";
  const taskRun = await beginRefreshTaskRun(env, {
    userId: input.userId,
    repoId: input.repoId,
    taskType: input.taskType,
    triggerType: input.triggerType,
    priority,
    itemId: input.itemId,
    baseWatermarkAt: config.watermark_updated_at,
  });
  return executeRefreshTaskRun(env, input, config, taskRun.id, priority);
}

async function executeRefreshTaskRun(
  env: WorkerEnv,
  input: RefreshTaskRequest,
  config: RefreshTaskConfigRow,
  runId: string,
  priority: "normal" | "high",
) {
  try {
    const handler = getRefreshTaskHandler(input.taskType);
    const execution = await handler.execute({
      env,
      input,
      config,
      runId,
      priority,
    });
    const { result, committedWatermarkAt } = execution;
    const finishedAt = await completeRefreshTaskRun(env, {
      runId,
      userId: input.userId,
      repoId: input.repoId,
      taskType: input.taskType,
      itemCount: result.itemCount,
      committedWatermarkAt,
    });
    return {
      id: runId,
      repository: input.repoId,
      taskType: input.taskType,
      status: "ready" as const,
      priority,
      ...result,
      finishedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "刷新任务失败";
    await failRefreshTaskRun(env, {
      runId,
      userId: input.userId,
      repoId: input.repoId,
      taskType: input.taskType,
      error: message,
    });
    throw error;
  }
}

export async function queueRefreshTask(
  env: WorkerEnv,
  input: RefreshTaskRequest,
) {
  await ensureRefreshTaskConfigs(env, input.userId);
  await requeueExpiredRefreshRuns(env, new Date().toISOString());
  const config = await findRefreshTaskConfig(
    env,
    input.userId,
    input.repoId,
    input.taskType,
  );
  if (!config) throw new HttpError(404, "刷新配置不存在");
  if (config.status === "queued") {
    const existing = await findQueuedRefreshTaskRun(
      env,
      input.userId,
      input.repoId,
      input.taskType,
    );
    if (existing) {
      return {
        id: existing.id,
        repository: input.repoId,
        taskType: input.taskType,
        status: "queued" as const,
        priority: existing.priority,
        itemCount: 0,
      };
    }
  }
  if (["queued", "running"].includes(config.status)) {
    throw new HttpError(409, "该刷新任务已在队列中或正在运行");
  }
  const priority = input.itemId ? "high" : "normal";
  const run = await beginRefreshTaskRun(env, {
    ...input,
    priority,
    baseWatermarkAt: config.watermark_updated_at,
    initialStatus: "queued",
  });
  return {
    id: run.id,
    repository: input.repoId,
    taskType: input.taskType,
    status: "queued" as const,
    priority,
    itemCount: 0,
  };
}

export async function executeQueuedRefreshTask(env: WorkerEnv, runId: string) {
  const row = await claimRefreshTaskRun(env, runId);
  if (!row || !isRefreshTaskType(row.task_type) || row.task_type === "deep_analysis") {
    return null;
  }
  const config = await findRefreshTaskConfig(
    env,
    row.user_id,
    row.repo_id,
    row.task_type,
  );
  if (!config) throw new HttpError(404, "刷新配置不存在");
  return executeRefreshTaskRun(
    env,
    {
      userId: row.user_id,
      repoId: row.repo_id,
      taskType: row.task_type,
      triggerType: row.trigger_type,
      itemId: row.item_id,
    },
    { ...config, watermark_updated_at: row.base_watermark_at },
    row.id,
    row.priority,
  );
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await work(items[index]);
    }
  }));
}

export async function runDueRefreshTasks(env: WorkerEnv) {
  const now = new Date().toISOString();
  await requeueExpiredRefreshRuns(env, now);
  const [due, queued] = await Promise.all([
    listDueRefreshTaskConfigs(env, now),
    listQueuedRefreshTaskRuns(env, 10),
  ]);
  const results: Array<{ repoId: string; taskType: string; ok: boolean }> = [];
  await Promise.all([
    runWithConcurrency(queued, 2, async (run) => {
      try {
        await executeQueuedRefreshTask(env, run.id);
        results.push({ repoId: run.repo_id, taskType: run.task_type, ok: true });
      } catch {
        results.push({ repoId: run.repo_id, taskType: run.task_type, ok: false });
      }
    }),
    runWithConcurrency(due, 2, async (config) => {
      if (!isRefreshTaskType(config.task_type) || config.task_type === "deep_analysis") return;
      if (config.refresh_rule === "manual") return;
      try {
        await runRefreshTask(env, {
          userId: config.user_id,
          repoId: config.repo_id,
          taskType: config.task_type,
          triggerType: "scheduled",
        });
        results.push({ repoId: config.repo_id, taskType: config.task_type, ok: true });
      } catch {
        results.push({ repoId: config.repo_id, taskType: config.task_type, ok: false });
      }
    }),
  ]);
  return results;
}

export { mapRefreshTaskState };
