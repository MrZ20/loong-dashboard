import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import {
  AI_PERMISSION_PROFILE_DEFINITIONS,
  AI_UPDATE_POLICIES,
  AI_WORKSPACE_MODES,
} from "../../shared/contracts/ai";
import {
  isAIExecutionMode,
  isAITaskKey,
} from "../domain/ai-task-catalog";
import {
  isLocalAgentEngine,
  localAgentEngineName,
  localJobTypeForAITask,
  validateLocalAgentModelSelection,
  validateLocalAgentRuntime,
} from "../domain/local-analysis";
import { cleanText, HttpError, json, readJson, requireMethod } from "../http";
import { latestLocalRunner } from "../repositories/local-runner";
import { executeResolvedAITask } from "../services/ai-execution";
import {
  clearAITaskError,
  listAITaskSettings,
  markAITaskRun,
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
    if (task.executionMode !== "api") {
      const runner = await latestLocalRunner(env);
      if (!isLocalAgentEngine(task.executionMode)) {
        throw new HttpError(409, "未知的本地 Agent 引擎");
      }
      const runtime = validateLocalAgentRuntime({
        runner,
        engine: task.executionMode,
        jobType: localJobTypeForAITask(task.key),
        permissionProfileId: task.permissionProfileId,
      });
      if (!runtime.ok) throw new HttpError(503, runtime.error);
      const selection = validateLocalAgentModelSelection({
        state: runtime.engine,
        providerId: task.engineProviderId,
        modelId: task.engineModelId,
        reasoningEffort: task.reasoningEffort,
      });
      if (!selection.ok) throw new HttpError(409, selection.error);
      await markAITaskRun(env, user.id, task.key, "ready");
      return json({
        ok: true,
        message: `${localAgentEngineName(task.executionMode)} Runner、模型和只读权限检查通过`,
      });
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

  const errorMatch = pathMatch(path, /^\/api\/settings\/ai-tasks\/([^/]+)\/error$/);
  if (errorMatch) {
    requireMethod(request, ["DELETE"]);
    if (!isAITaskKey(errorMatch[0])) throw new HttpError(404, "AI 任务不存在");
    await clearAITaskError(env, user.id, errorMatch[0]);
    return json({ ok: true });
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
    engineProviderId: cleanText(body.engineProviderId, 200),
    engineModelId: cleanText(body.engineModelId, 300),
    reasoningEffort: cleanText(body.reasoningEffort, 50),
    workspaceMode: AI_WORKSPACE_MODES.includes(body.workspaceMode as any)
      ? body.workspaceMode as any
      : "none",
    updatePolicy: AI_UPDATE_POLICIES.includes(body.updatePolicy as any)
      ? body.updatePolicy as any
      : "none",
    permissionProfileId: AI_PERMISSION_PROFILE_DEFINITIONS.some(
      (profile) => profile.id === body.permissionProfileId,
    ) ? body.permissionProfileId as any : "safe_readonly",
    promptTemplateId,
  });
  return json({ task });
}
