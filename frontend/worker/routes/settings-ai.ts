import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import { cleanText, HttpError, json, noContent, readJson, requireMethod } from "../http";
import {
  getAIProviders,
  normalizeProviderUrl,
  removeAIProvider,
  saveAIProvider,
} from "../services/ai-provider-settings";

function matchPath(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handleAIProviderSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/settings/ai-providers" && request.method === "GET") {
    return json({ providers: await getAIProviders(env, user.id) });
  }

  const providerMatch = matchPath(path, /^\/api\/settings\/ai-providers\/([^/]+)$/);
  if (providerMatch && request.method === "DELETE") {
    if (providerMatch[0] === "environment") {
      throw new HttpError(400, "环境变量配置不能删除");
    }
    if (!(await removeAIProvider(env, user.id, providerMatch[0]))) {
      throw new HttpError(404, "AI 配置不存在");
    }
    return noContent();
  }

  const providerId = providerMatch?.[0];
  requireMethod(request, [providerId ? "PUT" : "POST"]);
  const body = await readJson<Record<string, unknown>>(request);
  const name = cleanText(body.name, 100);
  const model = cleanText(body.model, 120);
  if (!name || !model) throw new HttpError(400, "配置名称和模型不能为空");
  let baseUrl: string;
  try {
    baseUrl = normalizeProviderUrl(env, cleanText(body.baseUrl, 500));
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "AI API 地址不正确");
  }
  const result = await saveAIProvider(env, {
    userId: user.id,
    providerId,
    name,
    baseUrl,
    apiMode: body.apiMode === "chat_completions" ? "chat_completions" : "responses",
    model,
    token: typeof body.token === "string" ? body.token.trim() : "",
  });
  if (!result) throw new HttpError(404, "AI 配置不存在");
  if ("conflict" in result) throw new HttpError(409, "同名 AI 配置已经存在");
  return json({ provider: result.provider }, { status: result.created ? 201 : 200 });
}
