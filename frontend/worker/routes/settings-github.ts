import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import { HttpError, json, readJson, requireMethod } from "../http";
import {
  getGithubSettings,
  removeGithubToken,
  saveGithubToken,
  verifyGithubToken,
} from "../services/github-settings";

export async function handleGithubSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/settings/github") {
    if (request.method === "GET") {
      return json({ github: await getGithubSettings(env, user.id) });
    }
    if (request.method === "DELETE") {
      return json({ github: await removeGithubToken(env, user.id) });
    }
    requireMethod(request, ["PUT"]);
    const body = await readJson<Record<string, unknown>>(request);
    return json({ github: await saveGithubToken(env, user.id, body.token) });
  }
  if (path === "/api/settings/github/test") {
    requireMethod(request, ["POST"]);
    return json({ github: await verifyGithubToken(env, user.id) });
  }
  throw new HttpError(404, "GitHub 设置接口不存在");
}
