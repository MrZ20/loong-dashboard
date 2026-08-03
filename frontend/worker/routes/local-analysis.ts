import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import { cleanText, HttpError, json, readJson, requireMethod } from "../http";
import {
  findUserLocalAnalysisJob,
  listLocalAnalysisEvents,
  listUserLocalAnalysisJobs,
  requestLocalAnalysisCancellation,
  updateLocalRunnerSettings,
} from "../repositories/local-runner";
import {
  enqueueRunnerAction,
  localRunnerSettingsState,
  mapLocalEvent,
  mapLocalJob,
} from "../services/local-analysis";

function pathMatch(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handleLocalAnalysis(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  const user = await requireUser(request, env);
  if (path === "/api/local-analysis/settings") {
    if (request.method === "GET") {
      return json(await localRunnerSettingsState(env, user.id));
    }
    requireMethod(request, ["PUT"]);
    const body = await readJson<Record<string, any>>(request);
    await updateLocalRunnerSettings(env, {
      userId: user.id,
      enabled: body.enabled === true,
      defaultProvider: cleanText(body.defaultProvider, 200),
      defaultModel: cleanText(body.defaultModel, 300),
      maxConcurrency: Math.max(1, Math.min(Number(body.maxConcurrency ?? 1), 8)),
      worktreeRetentionHours: Math.max(1, Math.min(Number(body.worktreeRetentionHours ?? 24), 720)),
      autoFetch: body.autoFetch !== false,
      timeoutSeconds: Math.max(60, Math.min(Number(body.timeoutSeconds ?? 900), 7_200)),
    });
    return json(await localRunnerSettingsState(env, user.id));
  }

  if (path === "/api/local-analysis/jobs") {
    requireMethod(request, ["GET"]);
    return json({
      jobs: (await listUserLocalAnalysisJobs(env, user.id)).map(mapLocalJob),
    });
  }

  if (path === "/api/local-analysis/actions") {
    requireMethod(request, ["POST"]);
    const body = await readJson<Record<string, any>>(request);
    const actionMap = {
      test_connection: "runner_check",
      check_repositories: "repository_check",
      initialize_repository: "repository_clone",
      refresh_models: "provider_refresh",
      cleanup_worktrees: "worktree_cleanup",
    } as const;
    const jobType = actionMap[body.action as keyof typeof actionMap];
    if (!jobType) throw new HttpError(400, "本地 Runner 操作不正确");
    const repoScope = cleanText(body.repository, 40);
    if (jobType === "repository_clone" && !["vllm", "vllm-ascend"].includes(repoScope)) {
      throw new HttpError(400, "初始化仓库时必须选择 vLLM 或 vLLM-Ascend");
    }
    return json({
      job: await enqueueRunnerAction(env, {
        userId: user.id,
        jobType,
        repoScope: repoScope || "all",
      }),
    }, { status: 202 });
  }

  const cancel = pathMatch(path, /^\/api\/local-analysis\/jobs\/([^/]+)\/cancel$/);
  if (cancel) {
    requireMethod(request, ["POST"]);
    const job = await findUserLocalAnalysisJob(env, user.id, cancel[0]);
    if (!job) throw new HttpError(404, "本地分析任务不存在");
    await requestLocalAnalysisCancellation(env, user.id, job.id);
    return json({ ok: true });
  }

  const jobMatch = pathMatch(path, /^\/api\/local-analysis\/jobs\/([^/]+)$/);
  if (jobMatch) {
    requireMethod(request, ["GET"]);
    const job = await findUserLocalAnalysisJob(env, user.id, jobMatch[0]);
    if (!job) throw new HttpError(404, "本地分析任务不存在");
    const after = Math.max(0, Number(new URL(request.url).searchParams.get("after") || 0));
    return json({
      job: mapLocalJob(job),
      events: (await listLocalAnalysisEvents(env, job.id, after)).map(mapLocalEvent),
    });
  }
  throw new HttpError(404, "本地分析接口不存在");
}
