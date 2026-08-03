import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import {
  isAIExecutionMode,
  isAITaskKey,
} from "../domain/ai-task-catalog";
import { runnerIsOnline } from "../domain/local-analysis";
import { cleanText, HttpError, json, readJson, requireMethod } from "../http";
import { latestLocalRunner } from "../repositories/local-runner";
import { executeResolvedAITask } from "../services/ai-execution";
import {
  listAITaskSettings,
  resolveAITask,
  saveAITaskSettings,
} from "../services/ai-task-settings";

function pathMatch(path: string, pattern: RegExp) {
  const match = path.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handleAITaskSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/settings/ai-management") {
    requireMethod(request, ["GET"]);
    return json(await listAITaskSettings(env, user.id));
  }

  const testMatch = pathMatch(path, /^\/api\/settings\/ai-tasks\/([^/]+)\/test$/);
  if (testMatch) {
    requireMethod(request, ["POST"]);
    if (!isAITaskKey(testMatch[0])) throw new HttpError(404, "AI 任务不存在");
    const task = await resolveAITask(env, user.id, testMatch[0]);
    if (task.executionMode === "opencode") {
      const runner = await latestLocalRunner(env);
      if (!runner || !runnerIsOnline(runner.last_seen_at)) {
        throw new HttpError(503, "OpenCode Runner 离线，当前任务不会自动回退到 API");
      }
      if (!runner.readonly_verified) {
        throw new HttpError(503, "OpenCode Runner 尚未通过只读权限验证");
      }
      const providers = runner.providers_json ? JSON.parse(runner.providers_json) : [];
      if (
        task.opencodeProviderId &&
        !providers.some((provider: any) => provider.id === task.opencodeProviderId)
      ) {
        throw new HttpError(409, "所选 OpenCode Provider 当前不可用");
      }
      return json({ ok: true, message: "Runner 在线，Provider / Model 和只读权限检查通过" });
    }
    const result = await executeResolvedAITask(env, {
      userId: user.id,
      task,
      messages: [
        { role: "system", content: "你正在执行 LoongBoard AI 配置连通性测试。" },
        { role: "user", content: "只回复：连接成功" },
      ],
      fallback: "",
    });
    if (result.provider !== "api") throw new HttpError(503, "当前 API 配置尚不可用");
    return json({ ok: true, message: `${result.providerName} / ${result.model} 连接成功` });
  }

  const taskMatch = pathMatch(path, /^\/api\/settings\/ai-tasks\/([^/]+)$/);
  if (!taskMatch || !isAITaskKey(taskMatch[0])) {
    throw new HttpError(404, "AI 任务设置接口不存在");
  }
  requireMethod(request, ["PUT"]);
  const body = await readJson<Record<string, unknown>>(request);
  if (!isAIExecutionMode(body.executionMode)) {
    throw new HttpError(400, "AI 执行方式不正确");
  }
  const promptTemplateId = cleanText(body.promptTemplateId, 200);
  if (!promptTemplateId) throw new HttpError(400, "必须选择一份提示词模板");
  const task = await saveAITaskSettings(env, user.id, taskMatch[0], {
    executionMode: body.executionMode,
    providerConfigId: cleanText(body.providerConfigId, 200),
    opencodeProviderId: cleanText(body.opencodeProviderId, 200),
    opencodeModelId: cleanText(body.opencodeModelId, 300),
    promptTemplateId,
  });
  return json({ task });
}

