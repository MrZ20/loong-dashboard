import type { WorkerEnv } from "../db";
import { parseJson } from "../mappers/database-row";
import { LOCAL_EVENT_TYPES } from "../domain/local-analysis";
import { cleanText, HttpError, json, readJson, requireMethod } from "../http";
import {
  appendLocalAnalysisEvents,
  claimNextLocalAnalysisJob,
  findLocalAnalysisJob,
  effectiveLocalRunnerPolicy,
  markLocalAnalysisJobRunning,
  upsertLocalRunnerHeartbeat,
} from "../repositories/local-runner";
import { completeRunnerJob } from "../services/local-runtime/completion";

function requireRunner(request: Request, env: WorkerEnv) {
  if (!env.LOCAL_RUNNER_TOKEN) {
    throw new HttpError(503, "本地 Runner 认证尚未配置");
  }
  if (request.headers.get("authorization") !== `Bearer ${env.LOCAL_RUNNER_TOKEN}`) {
    throw new HttpError(401, "Runner 认证失败");
  }
}

function pathMatch(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

function publicEventMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of [
    "repository", "commitSha", "path", "symbol", "query", "tool",
    "status", "count", "durationMs", "providerId", "modelId",
  ]) {
    const raw = input[key];
    if (typeof raw === "number" || typeof raw === "boolean") result[key] = raw;
    if (typeof raw === "string") {
      const clean = raw.trim().slice(0, 1_000);
      if (key === "path" && (clean.startsWith("/") || clean.includes(".."))) continue;
      result[key] = clean;
    }
  }
  return result;
}

export async function handleLocalRunner(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  requireRunner(request, env);
  if (path === "/api/local-runner/heartbeat") {
    requireMethod(request, ["POST"]);
    const body = await readJson<Record<string, any>>(request);
    const runnerId = cleanText(body.runnerId, 120);
    if (!runnerId) throw new HttpError(400, "缺少 Runner ID");
    const row = await upsertLocalRunnerHeartbeat(env, {
      id: runnerId,
      userId: cleanText(body.userId, 120),
      status: cleanText(body.status, 40) || "online",
      version: cleanText(body.version, 40),
      engineVersions: body.engineVersions && typeof body.engineVersions === "object"
        ? body.engineVersions
        : {},
      authConfigured: body.authConfigured === true,
      readonlyVerified: body.readonlyVerified === true,
      repositories: body.repositories && typeof body.repositories === "object"
        ? body.repositories
        : {},
      engineCatalogs: body.engineCatalogs && typeof body.engineCatalogs === "object"
        ? body.engineCatalogs
        : {},
      capabilities: body.capabilities && typeof body.capabilities === "object"
        ? body.capabilities
        : {},
      activeJobs: Math.max(0, Math.min(Number(body.activeJobs ?? 0), 100)),
      lastError: cleanText(body.lastError, 1_000) || null,
    });
    const policy = await effectiveLocalRunnerPolicy(env);
    return json({
      ok: true,
      runnerId: row?.id,
      policy: {
        maxConcurrency: Number(policy?.max_concurrency ?? 1),
        worktreeRetentionHours: Number(policy?.worktree_retention_hours ?? 24),
      },
    });
  }

  if (path === "/api/local-runner/claim") {
    requireMethod(request, ["POST"]);
    const body = await readJson<{ runnerId?: string }>(request);
    const runnerId = cleanText(body.runnerId, 120);
    if (!runnerId) throw new HttpError(400, "缺少 Runner ID");
    const job = await claimNextLocalAnalysisJob(env, runnerId);
    return json({
      job: job
        ? {
            id: job.id,
            userId: job.user_id,
            jobType: job.job_type,
            subjectKind: job.subject_kind,
            subjectKey: job.subject_key,
            repoScope: job.repo_scope,
            itemId: job.item_id ?? null,
            chatThreadId: job.chat_thread_id ?? null,
            sessionScope: job.session_scope,
            baseSha: job.base_sha ?? null,
            headSha: job.head_sha ?? null,
            targetRef: job.target_ref,
            providerId: job.provider_id,
            modelId: job.model_id,
            engineId: job.engine_id,
            agentSessionId: job.agent_session_id ?? null,
            request: parseJson(job.request_json, {}),
          }
        : null,
    });
  }

  const running = pathMatch(path, /^\/api\/local-runner\/jobs\/([^/]+)\/running$/);
  if (running) {
    requireMethod(request, ["POST"]);
    const body = await readJson<{ runnerId?: string }>(request);
    await markLocalAnalysisJobRunning(env, running[0], cleanText(body.runnerId, 120));
    return json({ ok: true });
  }

  const events = pathMatch(path, /^\/api\/local-runner\/jobs\/([^/]+)\/events$/);
  if (events) {
    requireMethod(request, ["POST"]);
    const body = await readJson<{ events?: unknown[] }>(request);
    const normalized = (Array.isArray(body.events) ? body.events : []).flatMap((event: any) => {
      if (!LOCAL_EVENT_TYPES.includes(event?.eventType)) return [];
      const sequence = Number(event.sequence);
      if (!Number.isInteger(sequence) || sequence < 1) return [];
      return [{
        sequence,
        eventType: event.eventType,
        source: cleanText(event.source, 40) || "system",
        level: ["info", "warning", "error"].includes(event.level)
          ? event.level
          : "info",
        message: cleanText(event.message, 1_000) || "任务状态已更新",
        metadata: publicEventMetadata(event.metadata),
        createdAt: cleanText(event.createdAt, 40) || new Date().toISOString(),
      }];
    });
    await appendLocalAnalysisEvents(env, events[0], normalized);
    return json({ ok: true, accepted: normalized.length });
  }

  const complete = pathMatch(path, /^\/api\/local-runner\/jobs\/([^/]+)\/complete$/);
  if (complete) {
    requireMethod(request, ["POST"]);
    const body = await readJson<Record<string, any>>(request);
    const status = ["completed", "failed", "cancelled"].includes(body.status)
      ? body.status
      : null;
    if (!status) throw new HttpError(400, "Runner 任务状态不正确");
    const job = await completeRunnerJob(env, {
      runnerId: cleanText(body.runnerId, 120),
      jobId: complete[0],
      status,
      result: body.result && typeof body.result === "object" ? body.result : {},
      error: cleanText(body.error, 2_000) || null,
    });
    return json({ ok: true, status: job?.status });
  }

  const jobMatch = pathMatch(path, /^\/api\/local-runner\/jobs\/([^/]+)$/);
  if (jobMatch) {
    requireMethod(request, ["GET"]);
    const job = await findLocalAnalysisJob(env, jobMatch[0]);
    if (!job) throw new HttpError(404, "Runner 任务不存在");
    return json({ status: job.status });
  }
  throw new HttpError(404, "本地 Runner 接口不存在");
}
