import { first, query, run, type WorkerEnv } from "../db";
import {
  REFRESH_DEFAULTS,
  REFRESH_TASK_TYPES,
  nextScheduledAt,
  type RefreshRule,
  type RefreshTaskType,
} from "../domain/refresh-policy";

export interface RefreshTaskConfigRow extends Record<string, unknown> {
  user_id: string;
  repo_id: string;
  task_type: RefreshTaskType;
  auto_enabled: number;
  interval_minutes: number | null;
  active_range_hours: number;
  refresh_rule: RefreshRule;
  max_items: number;
  include_ci_changes: number;
  include_comment_changes: number;
  status: "idle" | "queued" | "running" | "ready" | "failed";
  last_attempted_at: string | null;
  last_successful_at: string | null;
  watermark_updated_at: string | null;
  next_scheduled_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function ensureRefreshTaskConfigs(env: WorkerEnv, userId: string) {
  const repositories = await query<{ id: string }>(
    env,
    "SELECT id FROM repositories WHERE enabled = 1 ORDER BY id",
  );
  const now = new Date().toISOString();
  for (const repository of repositories) {
    for (const taskType of REFRESH_TASK_TYPES) {
      const defaults = REFRESH_DEFAULTS[taskType];
      await run(
        env,
        `INSERT INTO refresh_task_configs(
          user_id, repo_id, task_type, auto_enabled, interval_minutes,
          active_range_hours, refresh_rule, max_items, include_ci_changes,
          include_comment_changes, status, next_scheduled_at, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)
        ON CONFLICT(user_id, repo_id, task_type) DO NOTHING`,
        [
          userId,
          repository.id,
          taskType,
          defaults.autoEnabled ? 1 : 0,
          defaults.intervalMinutes,
          defaults.activeRangeHours,
          defaults.refreshRule,
          defaults.maxItems,
          defaults.includeCiChanges ? 1 : 0,
          defaults.includeCommentChanges ? 1 : 0,
          defaults.autoEnabled ? now : null,
          now,
          now,
        ],
      );
    }
  }
}

export function findRefreshTaskConfig(
  env: WorkerEnv,
  userId: string,
  repoId: string,
  taskType: RefreshTaskType,
) {
  return first<RefreshTaskConfigRow>(
    env,
    `SELECT * FROM refresh_task_configs
     WHERE user_id = ? AND repo_id = ? AND task_type = ?`,
    [userId, repoId, taskType],
  );
}

export function listRefreshTaskConfigs(env: WorkerEnv, userId: string) {
  return query<RefreshTaskConfigRow>(
    env,
    `SELECT * FROM refresh_task_configs
     WHERE user_id = ? ORDER BY repo_id, task_type`,
    [userId],
  );
}

export function listDueRefreshTaskConfigs(env: WorkerEnv, now: string) {
  return query<RefreshTaskConfigRow>(
    env,
    `SELECT * FROM refresh_task_configs
     WHERE auto_enabled = 1
       AND status != 'running'
       AND next_scheduled_at IS NOT NULL
       AND next_scheduled_at <= ?
     ORDER BY next_scheduled_at ASC
     LIMIT 20`,
    [now],
  );
}

export async function updateRefreshTaskConfig(
  env: WorkerEnv,
  userId: string,
  repoId: string,
  taskType: RefreshTaskType,
  input: {
    autoEnabled: boolean;
    intervalMinutes: number | null;
    activeRangeHours: number;
    refreshRule: RefreshRule;
    maxItems: number;
    includeCiChanges: boolean;
    includeCommentChanges: boolean;
  },
) {
  const now = new Date().toISOString();
  const next = nextScheduledAt(now, input.autoEnabled, input.intervalMinutes);
  await run(
    env,
    `UPDATE refresh_task_configs SET
      auto_enabled = ?, interval_minutes = ?, active_range_hours = ?,
      refresh_rule = ?, max_items = ?, include_ci_changes = ?,
      include_comment_changes = ?, next_scheduled_at = ?, updated_at = ?
     WHERE user_id = ? AND repo_id = ? AND task_type = ?`,
    [
      input.autoEnabled ? 1 : 0,
      input.intervalMinutes,
      input.activeRangeHours,
      input.refreshRule,
      input.maxItems,
      input.includeCiChanges ? 1 : 0,
      input.includeCommentChanges ? 1 : 0,
      input.autoEnabled
        ? next ?? (taskType === "classification" ? now : null)
        : null,
      now,
      userId,
      repoId,
      taskType,
    ],
  );
  return findRefreshTaskConfig(env, userId, repoId, taskType);
}

export async function beginRefreshTaskRun(
  env: WorkerEnv,
  input: {
    userId: string;
    repoId: string;
    taskType: RefreshTaskType;
    triggerType: "manual" | "scheduled" | "initial";
    priority: "normal" | "high";
    itemId?: string | null;
    baseWatermarkAt?: string | null;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO refresh_task_runs(
      id, user_id, repo_id, task_type, trigger_type, priority, item_id,
      status, base_watermark_at, started_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    [
      id,
      input.userId,
      input.repoId,
      input.taskType,
      input.triggerType,
      input.priority,
      input.itemId ?? null,
      input.baseWatermarkAt ?? null,
      now,
    ],
  );
  await run(
    env,
    `UPDATE refresh_task_configs SET status = 'running',
      last_attempted_at = ?, updated_at = ?
     WHERE user_id = ? AND repo_id = ? AND task_type = ?`,
    [now, now, input.userId, input.repoId, input.taskType],
  );
  return { id, startedAt: now };
}

export async function completeRefreshTaskRun(
  env: WorkerEnv,
  input: {
    runId: string;
    userId: string;
    repoId: string;
    taskType: RefreshTaskType;
    itemCount: number;
    committedWatermarkAt?: string | null;
  },
) {
  const config = await findRefreshTaskConfig(
    env,
    input.userId,
    input.repoId,
    input.taskType,
  );
  const now = new Date().toISOString();
  const next = nextScheduledAt(
    now,
    Boolean(config?.auto_enabled),
    config?.interval_minutes ?? null,
  );
  await run(
    env,
    `UPDATE refresh_task_runs SET status = 'ready', item_count = ?,
      committed_watermark_at = ?, finished_at = ? WHERE id = ?`,
    [input.itemCount, input.committedWatermarkAt ?? null, now, input.runId],
  );
  await run(
    env,
    `UPDATE refresh_task_configs SET status = 'ready',
      last_successful_at = ?,
      watermark_updated_at = COALESCE(?, watermark_updated_at),
      next_scheduled_at = ?, last_error = NULL, updated_at = ?
     WHERE user_id = ? AND repo_id = ? AND task_type = ?`,
    [
      now,
      input.committedWatermarkAt ?? null,
      next,
      now,
      input.userId,
      input.repoId,
      input.taskType,
    ],
  );
  return now;
}

export async function failRefreshTaskRun(
  env: WorkerEnv,
  input: {
    runId: string;
    userId: string;
    repoId: string;
    taskType: RefreshTaskType;
    error: string;
  },
) {
  const config = await findRefreshTaskConfig(
    env,
    input.userId,
    input.repoId,
    input.taskType,
  );
  const now = new Date().toISOString();
  const next = nextScheduledAt(
    now,
    Boolean(config?.auto_enabled),
    config?.interval_minutes ?? null,
  );
  const message = input.error.slice(0, 500);
  await run(
    env,
    `UPDATE refresh_task_runs SET status = 'failed', error = ?, finished_at = ?
     WHERE id = ?`,
    [message, now, input.runId],
  );
  await run(
    env,
    `UPDATE refresh_task_configs SET status = 'failed', last_error = ?,
      next_scheduled_at = ?, updated_at = ?
     WHERE user_id = ? AND repo_id = ? AND task_type = ?`,
    [message, next, now, input.userId, input.repoId, input.taskType],
  );
}

export function countPendingRefreshItems(
  env: WorkerEnv,
  repoId: string,
  taskType: RefreshTaskType,
  refreshRule: RefreshRule,
) {
  const predicate =
    taskType === "summary"
      ? "summary_status IN ('missing', 'stale', 'failed')"
      : taskType === "classification"
        ? refreshRule === "manual"
          ? "0"
          : refreshRule === "first_only"
            ? "classification_status IN ('missing', 'failed')"
            : refreshRule === "code_only"
              ? `(classification_status IN ('missing', 'failed') OR (
                  classification_status = 'possibly_stale' AND kind = 'pr' AND (
                    COALESCE(classification_head_sha, '') != COALESCE(head_sha, '')
                    OR classification_files_hash != files_hash
                  )
                ))`
              : "classification_status IN ('missing', 'possibly_stale', 'failed')"
        : "0";
  return first<{ count: number }>(
    env,
    `SELECT COUNT(*) AS count FROM community_items
     WHERE repo_id = ? AND ${predicate}`,
    [repoId],
  );
}

export function findSummaryJob(
  env: WorkerEnv,
  userId: string,
  itemId: string,
  versionKey: string,
  promptVersion: string,
) {
  return first<Record<string, any>>(
    env,
    `SELECT * FROM community_summary_jobs
     WHERE user_id = ? AND item_id = ? AND version_key = ? AND prompt_version = ?`,
    [userId, itemId, versionKey, promptVersion],
  );
}

export async function createSummaryJob(
  env: WorkerEnv,
  input: {
    userId: string;
    itemId: string;
    versionKey: string;
    promptVersion: string;
    priority: "normal" | "high";
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO community_summary_jobs(
      id, user_id, item_id, version_key, prompt_version, priority, status, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, 'queued', ?)
    ON CONFLICT(user_id, item_id, version_key, prompt_version) DO NOTHING`,
    [
      id,
      input.userId,
      input.itemId,
      input.versionKey,
      input.promptVersion,
      input.priority,
      now,
    ],
  );
  return findSummaryJob(
    env,
    input.userId,
    input.itemId,
    input.versionKey,
    input.promptVersion,
  );
}

export function updateSummaryJobStatus(
  env: WorkerEnv,
  id: string,
  status: "running" | "ready" | "failed",
  error: string | null = null,
) {
  const now = new Date().toISOString();
  return run(
    env,
    `UPDATE community_summary_jobs SET status = ?, error = ?,
      started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
      finished_at = CASE WHEN ? IN ('ready', 'failed') THEN ? ELSE finished_at END
     WHERE id = ?`,
    [status, error, status, now, status, now, id],
  );
}
