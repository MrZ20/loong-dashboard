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
import { createDailyDomainSnapshot, listDomains } from "../domains";
import { syncRepository } from "../github";
import {
  getTodaySummary,
  listCrossRepoImpacts,
  refreshCrossRepoImpacts,
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
import { generateAnalysis } from "./analysis";
import { handleChat } from "./chat";
import {
  analyzeItem,
  getCommunityDiffFiles,
  getCommunityItem,
  listCommunity,
} from "./community";
import {
  handleAnalyses,
  handleDocuments,
  handleWatchlist,
} from "./content";

function pathMatch(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handleApi(request: Request, env: WorkerEnv) {
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

  const repositorySync = pathMatch(path, /^\/api\/repositories\/([^/]+)\/sync$/);
  if (repositorySync) {
    requireMethod(request, ["POST"]);
    const user = await requireUser(request, env);
    const syncRun = await syncRepository(env, repositorySync[0], user.id);
    await refreshCrossRepoImpacts(env);
    return json({ run: syncRun });
  }
  if (path === "/api/repositories") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return json({ repositories: await listEnabledRepositories(env) });
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
    await requireUser(request, env);
    const snapshot = await createDailyDomainSnapshot(env, domainSnapshot[0]);
    if (!snapshot) throw new HttpError(404, "技术领域不存在");
    return json({ snapshot }, { status: 201 });
  }

  if (path === "/api/documents") return handleDocuments(request, env);
  const documentDetail = pathMatch(path, /^\/api\/documents\/([^/]+)$/);
  if (documentDetail) return handleDocuments(request, env, documentDetail[0]);

  if (path.startsWith("/api/settings/")) {
    return handleSettings(request, env, path);
  }
  if (path.startsWith("/api/chat/")) return handleChat(request, env, path);

  throw new HttpError(404, "API 接口不存在");
}

