import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import {
  isRefreshTaskType,
  type RefreshRule,
} from "../domain/refresh-policy";
import { HttpError, json, readJson, requireMethod } from "../http";
import {
  listRefreshSettings,
  saveRefreshSettings,
} from "../services/refresh-management";

export async function handleRefreshSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/settings/community-refresh") {
    requireMethod(request, ["GET"]);
    return json({ tasks: await listRefreshSettings(env, user.id) });
  }
  const match = path.match(
    /^\/api\/settings\/community-refresh\/([^/]+)\/([^/]+)$/,
  );
  if (!match) throw new HttpError(404, "社区数据刷新设置接口不存在");
  requireMethod(request, ["PUT"]);
  const repoId = decodeURIComponent(match[1]);
  const taskType = decodeURIComponent(match[2]);
  if (!isRefreshTaskType(taskType)) throw new HttpError(400, "刷新任务类型不正确");
  const body = await readJson<Partial<{
    autoEnabled: boolean;
    intervalMinutes: number | null;
    activeRangeHours: number;
    refreshRule: RefreshRule;
    maxItems: number;
    includeCiChanges: boolean;
    includeCommentChanges: boolean;
    stateFilter: "all" | "open" | "draft" | "merged" | "closed";
    domainFilter: string;
  }>>(request);
  return json({
    task: await saveRefreshSettings(env, user.id, repoId, taskType, body),
  });
}
