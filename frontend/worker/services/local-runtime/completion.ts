import type { WorkerEnv } from "../../db";
import { parseJson } from "../../mappers/database-row";
import {
  isLocalAgentEngine,
  localAgentEngineName,
  normalizeCodeReferences,
  type LocalAgentEngine,
} from "../../domain/local-analysis";
import { HttpError } from "../../http";
import { updateCommunityDeepAnalysisStatus } from "../../repositories/community";
import { markClassificationFailed } from "../../repositories/classifications";
import {
  failClassificationTaxonomyRefresh,
} from "../../repositories/classification-taxonomies";
import {
  completeLocalAnalysisJobRow,
  findLocalAnalysisJob,
  upsertSessionBinding,
} from "../../repositories/local-runner";
import {
  failRefreshTaskRun,
  updateSummaryJobStatus,
} from "../../repositories/refresh-tasks";
import { markSummaryFailed } from "../../repositories/summaries";
import { markAITaskRun } from "../ai-task-settings";

import {
  managedTaskKeyForLocalJob,
  resultAgentSessionId,
  text,
  texts,
} from "./helpers";
import { persistCompletedBusinessResult } from "./completion-handlers";

export async function completeRunnerJob(
  env: WorkerEnv,
  input: {
    runnerId: string;
    jobId: string;
    status: "completed" | "failed" | "cancelled";
    result: Record<string, any>;
    error: string | null;
  },
) {
  const job = await findLocalAnalysisJob(env, input.jobId);
  if (!job || job.runner_id !== input.runnerId) {
    throw new HttpError(404, "Runner 任务不存在");
  }
  const request = parseJson<Record<string, any>>(job.request_json, {});
  const runnerAction = [
    "runner_check",
    "repository_check",
    "repository_clone",
    "provider_refresh",
    "worktree_cleanup",
  ].includes(job.job_type);
  const engine: LocalAgentEngine | null = isLocalAgentEngine(job.engine_id)
    ? job.engine_id
    : null;
  if (!runnerAction && !engine) {
    throw new HttpError(409, "本地分析任务未指定执行引擎");
  }
  const agentName = engine ? localAgentEngineName(engine) : "本地 Runner";
  const managedTaskKey = managedTaskKeyForLocalJob(job);
  if (input.status !== "completed") {
    const failedSessionId = resultAgentSessionId(input.result);
    const failedCommits = input.result?.resolvedCommits && typeof input.result.resolvedCommits === "object"
      ? input.result.resolvedCommits as Record<string, string>
      : {};
    const failedCommit = text(failedCommits[job.repo_scope] || job.head_sha || "", 100);
    if (engine && failedSessionId && failedCommit && job.session_scope) {
      await upsertSessionBinding(env, {
        id: crypto.randomUUID(),
        userId: job.user_id,
        sessionScope: job.session_scope,
        repoScope: job.repo_scope,
        commitSha: failedCommit,
        agentSessionId: failedSessionId,
        engineId: engine,
        runnerId: input.runnerId,
        providerId: text(input.result?.providerId, 200) || job.provider_id,
        modelId: text(input.result?.modelId, 300) || job.model_id,
        summaryMd: "",
        confirmedFacts: [],
        unresolved: [input.error || "上一次本地分析未完成"],
        focus: [],
      });
    }
    await completeLocalAnalysisJobRow(env, {
      jobId: job.id,
      runnerId: input.runnerId,
      status: input.status,
      result: failedSessionId ? { agentSessionId: failedSessionId, commitSha: failedCommit } : {},
      error: input.error || (input.status === "cancelled" ? "任务已取消" : "本地分析失败"),
      localEvidence: false,
      agentSessionId: failedSessionId || null,
    });
    if (job.job_type === "deep_analysis" && job.item_id) {
      await updateCommunityDeepAnalysisStatus(env, job.item_id, "failed");
      if (request.refreshRunId) {
        await failRefreshTaskRun(env, {
          runId: request.refreshRunId,
          userId: job.user_id,
          repoId: job.repo_scope,
          taskType: "deep_analysis",
          error: input.error || "本地分析失败",
        });
      }
    }
    if (job.job_type === "managed_ai_task" && request.purpose === "community_summary" && job.item_id) {
      const version = request.version || {};
      const message = input.error || `${agentName} 摘要任务未完成`;
      if (request.summaryJobId) {
        await updateSummaryJobStatus(env, request.summaryJobId, "failed", message.slice(0, 500));
      }
      await markSummaryFailed(env, {
        itemId: job.item_id,
        message: message.slice(0, 500),
        bodyHash: text(version.bodyHash, 200),
        filesHash: text(version.filesHash, 200),
        headSha: text(version.headSha, 200) || null,
      });
    }
    if (job.job_type === "managed_ai_task" && request.purpose === "classification_supplement" && job.item_id) {
      await markClassificationFailed(
        env,
        job.item_id,
        (input.error || `${agentName} 分类补判未完成`).slice(0, 500),
      );
    }
    if (job.job_type === "managed_ai_task" && request.purpose === "taxonomy_refresh") {
      await failClassificationTaxonomyRefresh(env, {
        userId: job.user_id,
        repoId: text(request.repoId, 80),
        error: (input.error || `${agentName} 分类标准更新未完成`).slice(0, 500),
        now: nowIso(),
      });
    }
    if (managedTaskKey) {
      await markAITaskRun(
        env,
        job.user_id,
        managedTaskKey,
        "failed",
        input.error || `${agentName} 任务未完成`,
      );
    }
    return findLocalAnalysisJob(env, job.id);
  }

  const result = input.result || {};
  const resolvedCommits = result.resolvedCommits && typeof result.resolvedCommits === "object"
    ? result.resolvedCommits as Record<string, string>
    : {};
  const codeReferences = normalizeCodeReferences(result.codeReferences, resolvedCommits);
  const localEvidence = result.sourceRead === true && codeReferences.length > 0;
  const sessionId = resultAgentSessionId(result);
  const providerId = text(result.providerId, 200) || job.provider_id;
  const modelId = text(result.modelId, 300) || job.model_id;
  const commitSha = text(
    resolvedCommits[job.repo_scope] || result.commitSha || job.head_sha || job.target_ref,
    100,
  );
  let analysisDocumentId: string | null = null;

  analysisDocumentId = await persistCompletedBusinessResult({
    env,
    job,
    request,
    result,
    agentName,
    codeReferences,
    localEvidence,
    sessionId,
    providerId,
    modelId,
    commitSha,
  });

  if (engine && sessionId && job.session_scope && commitSha) {
    await upsertSessionBinding(env, {
      id: crypto.randomUUID(),
      userId: job.user_id,
      sessionScope: job.session_scope,
      repoScope: job.repo_scope,
      commitSha,
      agentSessionId: sessionId,
      engineId: engine,
      runnerId: input.runnerId,
      providerId,
      modelId,
      summaryMd: text(result.summaryMd, 20_000),
      confirmedFacts: texts(result.confirmedFacts),
      unresolved: texts(result.unresolvedIssues),
      focus: texts(result.focus),
    });
  }
  await completeLocalAnalysisJobRow(env, {
    jobId: job.id,
    runnerId: input.runnerId,
    status: "completed",
    result: runnerAction
      ? result
      : {
          summaryMd: text(result.summaryMd, 20_000),
          reportMd: text(result.reportMd || result.answerMd || result.outputText, 500_000),
          codeReferences,
          confirmedFacts: texts(result.confirmedFacts),
          unresolvedIssues: texts(result.unresolvedIssues),
          providerId,
          modelId,
          commitSha,
        },
    error: null,
    agentSessionId: sessionId || null,
    localEvidence,
    analysisDocumentId,
  });
  if (managedTaskKey) {
    await markAITaskRun(env, job.user_id, managedTaskKey, "ready");
  }
  return findLocalAnalysisJob(env, job.id);
}
