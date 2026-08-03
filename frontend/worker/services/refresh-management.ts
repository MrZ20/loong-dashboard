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
  completeRefreshTaskRun,
  countPendingRefreshItems,
  ensureRefreshTaskConfigs,
  failRefreshTaskRun,
  findRefreshTaskConfig,
  listDueRefreshTaskConfigs,
  listRefreshTaskConfigs,
  updateRefreshTaskConfig,
  type RefreshTaskConfigRow,
} from "../repositories/refresh-tasks";
import { refreshCommunityClassifications } from "./classification-refresh";
import { refreshCommunityFacts } from "./facts-refresh";
import { refreshCommunitySummaries } from "./summary-refresh";

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
    status: row.status,
    lastAttemptedAt: row.last_attempted_at,
    lastSuccessfulAt: row.last_successful_at,
    watermarkUpdatedAt: row.watermark_updated_at,
    nextScheduledAt: row.next_scheduled_at,
    lastError: row.last_error,
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
    const pending = await countPendingRefreshItems(
      env,
      row.repo_id,
      row.task_type,
      row.refresh_rule,
    );
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
  }>,
) {
  await ensureRefreshTaskConfigs(env, userId);
  const current = await findRefreshTaskConfig(env, userId, repoId, taskType);
  if (!current) throw new HttpError(404, "刷新配置不存在");
  const defaults = REFRESH_DEFAULTS[taskType];
  const intervalMinutes = input.intervalMinutes === null
    ? null
    : Math.min(Math.max(Number(input.intervalMinutes ?? current.interval_minutes ?? defaults.intervalMinutes ?? 60), 15), 43_200);
  const activeRangeHours = Math.min(
    Math.max(Number(input.activeRangeHours ?? current.active_range_hours), 24),
    2_160,
  );
  const maxItems = Math.min(Math.max(Number(input.maxItems ?? current.max_items), 1), 500);
  const allowedRules: Record<RefreshTaskType, RefreshRule[]> = {
    facts: ["updated_since_success"],
    summary: ["code_only", "code_or_body", "any_update", "manual"],
    classification: ["first_only", "code_only", "any_update", "manual"],
    deep_analysis: ["manual"],
  };
  const candidateRule = input.refreshRule ?? current.refresh_rule;
  const refreshRule = allowedRules[taskType].includes(candidateRule)
    ? candidateRule
    : defaults.refreshRule;
  await updateRefreshTaskConfig(env, userId, repoId, taskType, {
    autoEnabled: taskType === "deep_analysis"
      ? false
      : refreshRule === "manual"
        ? false
        : Boolean(input.autoEnabled ?? current.auto_enabled),
    intervalMinutes: taskType === "classification" || taskType === "deep_analysis"
      ? null
      : intervalMinutes,
    activeRangeHours,
    refreshRule,
    maxItems,
    includeCiChanges: taskType === "summary" && Boolean(
      input.includeCiChanges ?? current.include_ci_changes,
    ),
    includeCommentChanges: taskType === "summary" && Boolean(
      input.includeCommentChanges ?? current.include_comment_changes,
    ),
  });
  const tasks = await listRefreshSettings(env, userId);
  return tasks.find(
    (task) => task.repoId === repoId && task.taskType === taskType,
  )!;
}

export async function runRefreshTask(
  env: WorkerEnv,
  input: {
    userId: string;
    repoId: string;
    taskType: Exclude<RefreshTaskType, "deep_analysis">;
    triggerType: "manual" | "scheduled" | "initial";
    itemId?: string | null;
  },
) {
  await ensureRefreshTaskConfigs(env, input.userId);
  const config = await findRefreshTaskConfig(
    env,
    input.userId,
    input.repoId,
    input.taskType,
  );
  if (!config) throw new HttpError(404, "刷新配置不存在");
  if (config.status === "running") throw new HttpError(409, "该刷新任务正在运行");
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
  try {
    const result = input.taskType === "facts"
      ? await refreshCommunityFacts(env, {
          userId: input.userId,
          repoId: input.repoId,
          watermark: input.itemId ? null : config.watermark_updated_at,
          activeRangeHours: Number(config.active_range_hours),
          maxItems: Number(config.max_items),
          itemId: input.itemId,
        })
      : input.taskType === "summary"
        ? await refreshCommunitySummaries(env, {
            userId: input.userId,
            repoId: input.repoId,
            activeRangeHours: Number(config.active_range_hours),
            maxItems: Number(config.max_items),
            itemId: input.itemId,
            priority,
          })
        : await refreshCommunityClassifications(env, {
            userId: input.userId,
            repoId: input.repoId,
            refreshRule: config.refresh_rule,
            maxItems: Number(config.max_items),
            itemId: input.itemId,
            forceManual: input.triggerType === "manual",
          });
    const committedWatermarkAt = input.taskType === "facts" && !input.itemId
      ? (result as { watermark?: string | null }).watermark ?? null
      : null;
    const finishedAt = await completeRefreshTaskRun(env, {
      runId: taskRun.id,
      userId: input.userId,
      repoId: input.repoId,
      taskType: input.taskType,
      itemCount: result.itemCount,
      committedWatermarkAt,
    });
    return {
      id: taskRun.id,
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
      runId: taskRun.id,
      userId: input.userId,
      repoId: input.repoId,
      taskType: input.taskType,
      error: message,
    });
    throw error;
  }
}

export async function runDueRefreshTasks(env: WorkerEnv) {
  const due = await listDueRefreshTaskConfigs(env, new Date().toISOString());
  const results: Array<{ repoId: string; taskType: string; ok: boolean }> = [];
  for (const config of due) {
    if (!isRefreshTaskType(config.task_type) || config.task_type === "deep_analysis") continue;
    if (config.refresh_rule === "manual") continue;
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
  }
  return results;
}

export { mapRefreshTaskState };
