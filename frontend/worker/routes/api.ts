import {
  clearSessionCookie,
  createDevelopmentSession,
  getAuthenticatedUser,
  requireUser,
} from "../auth";
import {
  initializeDatabase,
  type WorkerEnv,
} from "../db";
import { createDailyDomainSnapshot, listDomains } from "../services/domain-maps";
import {
  getTodaySummary,
  listCrossRepoImpacts,
  updateCrossRepoImpactStatus,
} from "../intelligence";
import {
  cleanText,
  HttpError,
  json,
  readJson,
  requireMethod,
} from "../http";
import { handleSettings } from "../settings";
import { listEnabledRepositories } from "../repositories/repositories";
import {
  listRefreshSettings,
  executeQueuedRefreshTask,
  queueRefreshTask,
  runRefreshTask,
} from "../services/refresh-management";
import { isRefreshTaskType } from "../domain/refresh-policy";
import { generateAnalysis } from "./analysis";
import { handleChat } from "./chat";
import { handleLocalAnalysis } from "./local-analysis";
import { handleLocalRunner } from "./local-runner";
import {
  analyzeItem,
  getCommunityDiffFiles,
  getCommunityItem,
  listCommunity,
} from "./community";
import {
  generateDocumentDraft,
  handleAnalyses,
  handleDocuments,
  handleWatchlist,
} from "./content";

function pathMatch(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handleApi(
  request: Request,
  env: WorkerEnv,
  context?: { waitUntil(promise: Promise<unknown>): void },
) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") {
    return json({
      ok: true,
      database: Boolean(env.DB),
      aiConfigured: Boolean(env.AI_API_KEY),
      githubConfigured: Boolean(env.GITHUB_TOKEN),
      timestamp: new Date().toISOString(),
    });
  }
  if (path === "/api/auth/providers") {
    return json({
      mode: env.ALLOW_DEV_AUTH === "true" ? "development" : "chatgpt",
      signInPath: "/signin-with-chatgpt?return_to=/",
      signOutPath: "/signout-with-chatgpt?return_to=/login",
    });
  }

  await initializeDatabase(env);

  if (path.startsWith("/api/local-runner/")) {
    return handleLocalRunner(request, env, path);
  }

  if (path === "/api/auth/me") {
    requireMethod(request, ["GET"]);
    const user = await getAuthenticatedUser(request, env);
    if (!user) throw new HttpError(401, "请先登录");
    return json({ user });
  }
  if (path === "/api/auth/dev-login") {
    requireMethod(request, ["POST"]);
    const body = await readJson<{
      email?: string;
      displayName?: string;
      password?: string;
    }>(request);
    const cookie = await createDevelopmentSession(
      env,
      cleanText(body.email, 200),
      cleanText(body.displayName, 100),
      cleanText(body.password, 500),
      new URL(request.url).protocol === "https:",
    );
    return json({ ok: true }, { headers: { "set-cookie": cookie } });
  }
  if (path === "/api/auth/logout") {
    requireMethod(request, ["POST"]);
    return json(
      { ok: true },
      {
        headers: {
          "set-cookie": clearSessionCookie(
            new URL(request.url).protocol === "https:",
          ),
        },
      },
    );
  }

  const repositoryRefresh = pathMatch(
    path,
    /^\/api\/repositories\/([^/]+)\/refresh\/([^/]+)$/,
  );
  if (repositoryRefresh) {
    requireMethod(request, ["POST"]);
    const user = await requireUser(request, env);
    const taskType = repositoryRefresh[1];
    if (!isRefreshTaskType(taskType)) throw new HttpError(400, "刷新任务类型不正确");
    if (taskType === "deep_analysis") {
      throw new HttpError(400, "深度分析只能从具体 PR 或 Issue 启动");
    }
    const body = await readJson<{ itemId?: string }>(request);
    const itemId = typeof body.itemId === "string" ? body.itemId : null;
    if (!itemId) {
      const run = await queueRefreshTask(env, {
        userId: user.id,
        repoId: repositoryRefresh[0],
        taskType,
        triggerType: "manual",
      });
      const execution = executeQueuedRefreshTask(env, run.id);
      if (context) {
        context.waitUntil(execution.catch(() => undefined));
        return json({ run }, { status: 202 });
      }
      return json({ run: await execution });
    }
    return json({
      run: await runRefreshTask(env, {
        userId: user.id,
        repoId: repositoryRefresh[0],
        taskType,
        triggerType: "manual",
        itemId,
      }),
    });
  }
  if (path === "/api/repositories") {
    requireMethod(request, ["GET"]);
    const user = await requireUser(request, env);
    const [repositories, tasks] = await Promise.all([
      listEnabledRepositories(env),
      listRefreshSettings(env, user.id),
    ]);
    return json({
      repositories: repositories.map((repository) => ({
        ...repository,
        refreshTasks: tasks.filter((task) => task.repoId === repository.id),
      })),
    });
  }

  if (path === "/api/community") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return listCommunity(request, env);
  }
  if (path === "/api/today") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    const repo = new URL(request.url).searchParams.get("repo");
    if (!repo) throw new HttpError(400, "缺少仓库参数");
    return json({ summary: await getTodaySummary(env, repo) });
  }
  if (path === "/api/impacts") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return json({ impacts: await listCrossRepoImpacts(env) });
  }
  const impactDetail = pathMatch(path, /^\/api\/impacts\/([^/]+)$/);
  if (impactDetail) {
    requireMethod(request, ["PATCH"]);
    await requireUser(request, env);
    const body = await readJson<{ status?: string }>(request);
    const impact = await updateCrossRepoImpactStatus(
      env,
      impactDetail[0],
      cleanText(body.status, 40),
    );
    if (!impact) throw new HttpError(404, "影响关系不存在或状态无效");
    return json({ ok: true });
  }
  const communityDiffFiles = pathMatch(
    path,
    /^\/api\/community\/([^/]+)\/pr\/(\d+)\/diff-files$/,
  );
  if (communityDiffFiles) {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return getCommunityDiffFiles(
      request,
      env,
      communityDiffFiles[0],
      communityDiffFiles[1],
    );
  }
  const communityAnalyze = pathMatch(
    path,
    /^\/api\/community\/([^/]+)\/(pr|issue)\/(\d+)\/analyze$/,
  );
  if (communityAnalyze) {
    requireMethod(request, ["POST"]);
    return analyzeItem(
      request,
      env,
      communityAnalyze[0],
      communityAnalyze[1],
      communityAnalyze[2],
    );
  }
  const communityDetail = pathMatch(
    path,
    /^\/api\/community\/([^/]+)\/(pr|issue)\/(\d+)$/,
  );
  if (communityDetail) {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return getCommunityItem(
      request,
      env,
      communityDetail[0],
      communityDetail[1],
      communityDetail[2],
    );
  }

  if (path === "/api/watchlist") return handleWatchlist(request, env);
  const watchItem = pathMatch(path, /^\/api\/watchlist\/(.+)$/);
  if (watchItem) return handleWatchlist(request, env, watchItem[0]);

  if (path === "/api/analyses/generate") {
    requireMethod(request, ["POST"]);
    return generateAnalysis(request, env);
  }
  if (path === "/api/analyses") return handleAnalyses(request, env);
  const analysisDetail = pathMatch(path, /^\/api\/analyses\/([^/]+)$/);
  if (analysisDetail) return handleAnalyses(request, env, analysisDetail[0]);

  if (path === "/api/domains") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return json({ domains: await listDomains(env) });
  }
  const domainSnapshot = pathMatch(
    path,
    /^\/api\/domains\/([^/]+)\/snapshot$/,
  );
  if (domainSnapshot) {
    requireMethod(request, ["POST"]);
    const user = await requireUser(request, env);
    const result = await createDailyDomainSnapshot(env, user.id, domainSnapshot[0]);
    if (!result) throw new HttpError(404, "技术领域不存在");
    return json(result, { status: result.job ? 202 : 201 });
  }

  if (path === "/api/documents/generate") return generateDocumentDraft(request, env);
  if (path === "/api/documents") return handleDocuments(request, env);
  const documentDetail = pathMatch(path, /^\/api\/documents\/([^/]+)$/);
  if (documentDetail) return handleDocuments(request, env, documentDetail[0]);

  if (path.startsWith("/api/settings/")) {
    return handleSettings(request, env, path);
  }
  if (path.startsWith("/api/local-analysis/")) {
    return handleLocalAnalysis(request, env, path);
  }
  if (path.startsWith("/api/chat/")) return handleChat(request, env, path);

  throw new HttpError(404, "API 接口不存在");
}
