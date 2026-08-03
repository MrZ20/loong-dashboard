import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import { isPromptFeatureKey } from "../domain/prompt-catalog";
import {
  cleanText,
  HttpError,
  json,
  noContent,
  readJson,
  requireMethod,
} from "../http";
import {
  activatePromptTemplate,
  createPromptTemplate,
  removePromptTemplate,
  updatePromptTemplate,
} from "../services/prompt-management";
import { listPromptCenter } from "../services/prompt-resolution";

function matchPath(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handlePromptSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/settings/ai-prompts") {
    if (request.method === "GET") {
      return json({ features: await listPromptCenter(env, user.id) });
    }
    requireMethod(request, ["POST"]);
    const body = await readJson<Record<string, unknown>>(request);
    if (!isPromptFeatureKey(body.featureKey)) {
      throw new HttpError(400, "未知的 AI 功能");
    }
    const name = cleanText(body.name, 80);
    const content = cleanText(body.content, 8_000);
    if (!name || !content) throw new HttpError(400, "名称和提示词内容不能为空");
    const template = await createPromptTemplate(env, user.id, {
      featureKey: body.featureKey,
      name,
      content,
      makeActive: body.makeActive === true,
    });
    return json({ template }, { status: 201 });
  }

  const activate = matchPath(
    path,
    /^\/api\/settings\/ai-prompts\/([^/]+)\/activate$/,
  );
  if (activate) {
    requireMethod(request, ["POST"]);
    return json(await activatePromptTemplate(env, user.id, activate[0]));
  }

  const template = matchPath(
    path,
    /^\/api\/settings\/ai-prompts\/([^/]+)$/,
  );
  if (template) {
    if (request.method === "DELETE") {
      await removePromptTemplate(env, user.id, template[0]);
      return noContent();
    }
    requireMethod(request, ["PUT"]);
    const body = await readJson<Record<string, unknown>>(request);
    const name = cleanText(body.name, 80);
    const content = cleanText(body.content, 8_000);
    if (!name || !content) throw new HttpError(400, "名称和提示词内容不能为空");
    return json({
      template: await updatePromptTemplate(env, user.id, template[0], {
        name,
        content,
      }),
    });
  }

  throw new HttpError(404, "提示词设置接口不存在");
}
