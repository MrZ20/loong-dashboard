import { analyzeCommunityItem } from "../../ai";
import type { WorkerEnv } from "../../db";
import { parseJson } from "../../mappers/database-row";
import { aiTaskKeyForFeature } from "../../domain/ai-task-catalog";
import { buildIssueAnalysisInput, buildPrAnalysisInput } from "../../domain/analysis-quality";
import { HttpError } from "../../http";
import { createCommunityAnalysis, findCommunityRow, updateCommunityDeepAnalysisStatus, updateCommunityDeepAnalysisStatusForVersion } from "../../repositories/community";
import { enqueueLocalAnalysisJob, findSessionBinding, latestSessionBinding } from "../../repositories/local-runner";
import { beginRefreshTaskRun, completeRefreshTaskRun, ensureRefreshTaskConfigs, failRefreshTaskRun } from "../../repositories/refresh-tasks";
import { ensurePersistedAITask, markAITaskRun, resolveAITask } from "../ai-task-settings";
import { requireAvailableRunner } from "./availability";
import { localExecutionPolicy, localTaskSelection, nowIso } from "./helpers";
import { mapLocalJob, rowAgentSessionId } from "./mappers";

export async function enqueueCommunityDeepAnalysis(
  env: WorkerEnv,
  input: {
    userId: string;
    repo: string;
    kind: "pr" | "issue";
    number: number;
    userRequirement: string;
    providerId?: string;
    modelId?: string;
  },
) {
  const row = await findCommunityRow(env, input.repo, input.kind, input.number);
  if (!row) throw new HttpError(404, "社区条目不存在");
  const task = await resolveAITask(
    env,
    input.userId,
    aiTaskKeyForFeature(
      input.kind === "pr" ? "pr_deep_analysis" : "issue_deep_analysis",
      input.repo,
    ),
  );
  if (task.executionMode === "api") {
    throw new HttpError(409, "该深度分析任务当前不是本地 Agent 执行方式");
  }
  const selection = localTaskSelection(task);
  const { settings } = await requireAvailableRunner(
    env, input.userId, selection.engine, "deep_analysis", selection.permissionProfileId,
  );
  await ensurePersistedAITask(env, input.userId, task);
  const prompt = task.prompt;
  const sessionScope = `community:${input.repo}:${input.kind}:${input.number}`;
  const versionKey = input.kind === "pr"
    ? row.head_sha || row.content_version || row.body_hash
    : row.body_hash || row.updated_at;
  const [binding, previousBinding] = await Promise.all([
    findSessionBinding(env, input.userId, sessionScope, versionKey, selection.engine),
    latestSessionBinding(env, input.userId, sessionScope, selection.engine),
  ]);
  const diff = parseJson<Record<string, any> | null>(row.diff_json, null);
  const evidence = input.kind === "pr"
    ? buildPrAnalysisInput({
        promptType: "pr-deep-analysis",
        repository: `vllm-project/${input.repo}`,
        number: input.number,
        title: row.title,
        bodyMd: row.body_md || "",
        baseSha: row.base_sha ?? null,
        headSha: row.head_sha ?? null,
        state: row.state,
        diff,
        patches: [],
        skipped: [],
        missingPatchPaths: Array.isArray(diff?.entries)
          ? diff.entries.map((entry: any) => String(entry.path || "")).filter(Boolean)
          : [],
        reviewSignal: parseJson(row.review_signal_json, null),
      })
    : buildIssueAnalysisInput({
        promptType: "issue-deep-analysis",
        repository: `vllm-project/${input.repo}`,
        number: input.number,
        title: row.title,
        bodyMd: row.body_md || "",
        labels: parseJson(row.labels_json, []),
        author: row.author || "",
        comments: Number(row.comments ?? 0),
        state: row.state,
        updatedAt: row.updated_at,
      });
  await ensureRefreshTaskConfigs(env, input.userId);
  const refreshRun = await beginRefreshTaskRun(env, {
    userId: input.userId,
    repoId: input.repo,
    taskType: "deep_analysis",
    triggerType: "manual",
    priority: "high",
    itemId: row.id,
  });
  const jobId = crypto.randomUUID();
  const job = await enqueueLocalAnalysisJob(env, {
    id: jobId,
    userId: input.userId,
    jobType: "deep_analysis",
    engineId: selection.engine,
    subjectKind: input.kind,
    subjectKey: `${input.repo}:${input.kind}:${input.number}`,
    repoScope: input.repo,
    itemId: row.id,
    sessionScope,
    baseSha: row.base_sha ?? null,
    headSha: row.head_sha ?? null,
    targetRef: row.head_sha || "HEAD",
    providerId: selection.providerId,
    modelId: selection.modelId,
    agentSessionId: rowAgentSessionId(binding),
    priority: 100,
    request: {
      ...localExecutionPolicy(selection),
      reasoningEffort: selection.reasoningEffort,
      refreshRunId: refreshRun.id,
      repository: input.repo,
      number: input.number,
      kind: input.kind,
      prompt: {
        type: input.kind === "pr" ? "pr-deep-analysis" : "issue-deep-analysis",
        version: prompt.promptVersion,
        templateId: prompt.templateId,
        templateName: prompt.name,
        revision: prompt.revision,
        systemContract: prompt.systemContract,
        instruction: prompt.instruction,
      },
      evidence,
      analyzedVersion: {
        headSha: row.head_sha ?? null,
        bodyHash: row.body_hash || "",
        filesHash: row.files_hash || "",
      },
      userRequirement: input.userRequirement,
      previousVersion:
        previousBinding && previousBinding.commit_sha !== versionKey
          ? {
              commitSha: previousBinding.commit_sha,
              summaryMd: previousBinding.summary_md,
              confirmedFacts: parseJson(previousBinding.confirmed_facts_json, []),
              unresolved: parseJson(previousBinding.unresolved_json, []),
            }
          : null,
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
      autoFetch: Boolean(settings?.auto_fetch),
    },
  });
  await updateCommunityDeepAnalysisStatus(env, row.id, "running");
  await markAITaskRun(env, input.userId, task.key, "queued");
  return mapLocalJob(job!);
}

export async function startCommunityDeepAnalysis(
  env: WorkerEnv,
  input: {
    userId: string;
    repo: string;
    kind: "pr" | "issue";
    number: number;
    userRequirement: string;
  },
) {
  const taskKey = aiTaskKeyForFeature(
    input.kind === "pr" ? "pr_deep_analysis" : "issue_deep_analysis",
    input.repo,
  );
  const task = await resolveAITask(env, input.userId, taskKey);
  if (task.executionMode !== "api") {
    return {
      job: await enqueueCommunityDeepAnalysis(env, input),
      analysis: null,
    };
  }
  const row = await findCommunityRow(env, input.repo, input.kind, input.number);
  if (!row) throw new HttpError(404, "社区条目不存在");
  const diff = parseJson<Record<string, any> | null>(row.diff_json, null);
  const context = input.kind === "pr"
    ? buildPrAnalysisInput({
        promptType: "pr-deep-analysis",
        repository: `vllm-project/${input.repo}`,
        number: input.number,
        title: row.title,
        bodyMd: row.body_md || "",
        baseSha: row.base_sha ?? null,
        headSha: row.head_sha ?? null,
        state: row.state,
        diff,
        patches: Array.isArray(diff?.entries)
          ? diff.entries.filter((entry: any) => typeof entry.patch === "string")
          : [],
        skipped: [],
        missingPatchPaths: Array.isArray(diff?.entries)
          ? diff.entries
              .filter((entry: any) => typeof entry.patch !== "string")
              .map((entry: any) => String(entry.path || ""))
              .filter(Boolean)
          : [],
        reviewSignal: parseJson(row.review_signal_json, null),
      })
    : buildIssueAnalysisInput({
        promptType: "issue-deep-analysis",
        repository: `vllm-project/${input.repo}`,
        number: input.number,
        title: row.title,
        bodyMd: row.body_md || "",
        labels: parseJson(row.labels_json, []),
        author: row.author || "",
        comments: Number(row.comments ?? 0),
        state: row.state,
        updatedAt: row.updated_at,
      });
  await ensureRefreshTaskConfigs(env, input.userId);
  const refreshRun = await beginRefreshTaskRun(env, {
    userId: input.userId,
    repoId: input.repo,
    taskType: "deep_analysis",
    triggerType: "manual",
    priority: "high",
    itemId: row.id,
  });
  await updateCommunityDeepAnalysisStatus(env, row.id, "running");
  try {
    const result = await analyzeCommunityItem(env, {
      userId: input.userId,
      repo: input.repo,
      kind: input.kind,
      context,
      userRequirement: input.userRequirement,
    });
    const createdAt = nowIso();
    const analysis = await createCommunityAnalysis(env, {
      id: crypto.randomUUID(),
      kind: input.kind,
      scope: `${input.repo}:${input.kind}:${input.number}`,
      title: `${row.title} · AI 深度分析`,
      summaryMd: result.content.split("\n\n").slice(0, 2).join("\n\n").slice(0, 2_000),
      contentMd: result.content,
      prompt: result.prompt.instruction,
      promptTemplateId: result.prompt.templateId,
      promptTemplateName: result.prompt.name,
      promptRevision: result.prompt.revision,
      model: result.model,
      baseSha: row.base_sha ?? null,
      headSha: row.head_sha ?? null,
      bodyHash: row.body_hash || "",
      filesHash: row.files_hash || "",
      promptType: context.promptType,
      promptVersion: result.prompt.promptVersion,
      runner: result.executionMode,
      provider: result.providerName,
      analysisSource: "ai",
      evidenceCompleteness: result.evidenceCompleteness,
      versionStatus: "current",
      sourceRefs: context.evidence,
      userId: input.userId,
      createdAt,
    });
    await updateCommunityDeepAnalysisStatusForVersion(env, {
      itemId: row.id,
      status: "ready",
      headSha: row.head_sha ?? null,
      bodyHash: row.body_hash || "",
      filesHash: row.files_hash || "",
    });
    await completeRefreshTaskRun(env, {
      runId: refreshRun.id,
      userId: input.userId,
      repoId: input.repo,
      taskType: "deep_analysis",
      itemCount: 1,
    });
    return { job: null, analysis };
  } catch (error) {
    await updateCommunityDeepAnalysisStatus(env, row.id, "failed");
    await failRefreshTaskRun(env, {
      runId: refreshRun.id,
      userId: input.userId,
      repoId: input.repo,
      taskType: "deep_analysis",
      error: error instanceof Error ? error.message : "AI 深度分析失败",
    });
    throw error;
  }
}
