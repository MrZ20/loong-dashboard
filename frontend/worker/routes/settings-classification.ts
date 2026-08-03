import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import { HttpError, json, requireMethod } from "../http";
import {
  listClassificationTaxonomyStates,
  refreshClassificationTaxonomy,
} from "../services/classification-taxonomies";

export async function handleClassificationSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/settings/classification-taxonomies") {
    requireMethod(request, ["GET"]);
    return json({ taxonomies: await listClassificationTaxonomyStates(env, user.id) });
  }
  const match = path.match(/^\/api\/settings\/classification-taxonomies\/([^/]+)\/refresh$/);
  if (!match) throw new HttpError(404, "分类标准设置接口不存在");
  requireMethod(request, ["POST"]);
  const result = await refreshClassificationTaxonomy(
    env,
    user.id,
    decodeURIComponent(match[1]),
  );
  return json(result, { status: result.job ? 202 : 200 });
}
