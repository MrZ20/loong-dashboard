import { analyzeCommunityItem } from "../ai";
import { parseJson, type WorkerEnv } from "../db";
import { aiTaskKeyForFeature, type AITaskKey } from "../domain/ai-task-catalog";
import { getRepositoryTaxonomy } from "../domain/classification/registry";
import { validateTaxonomyOverlay } from "../domain/classification/taxonomy-overlay";
import {
  analysisVersionMatches,
  buildIssueAnalysisInput,
  buildPrAnalysisInput,
  validateIssueSummaryOutput,
  validatePrSummaryOutput,
} from "../domain/analysis-quality";
import {
  normalizeCodeReferences,
  publicRunnerState,
  runnerIsOnline,
  type LocalJobType,
} from "../domain/local-analysis";
import { HttpError } from "../http";
import {
  createMessageRow,
  findThreadRow,
  touchThreadRow,
} from "../repositories/chat";
import {
  createCommunityAnalysis,
  findCommunityRow,
  markCommunityDeepAnalysisOutdatedIfRunning,
  updateCommunityDeepAnalysisStatus,
  updateCommunityDeepAnalysisStatusForVersion,
} from "../repositories/community";
import { saveDomainSnapshot } from "../repositories/domain-maps";
import {
  findClassificationItemVersion,
  markClassificationFailed,
  saveClassificationResult,
} from "../repositories/classifications";
import {
  failClassificationTaxonomyRefresh,
  saveClassificationTaxonomyOverride,
} from "../repositories/classification-taxonomies";
import {
  completeLocalAnalysisJobRow,
  createLocalAnalysisDocumentRow,
  enqueueLocalAnalysisJob,
  ensureLocalRunnerSettings,
  findLocalAnalysisJob,
  findSessionBinding,
  latestLocalRunner,
  latestSessionBinding,
  updateThreadLocalAnalysisState,
  upsertSessionBinding,
} from "../repositories/local-runner";
import {
  beginRefreshTaskRun,
  completeRefreshTaskRun,
  ensureRefreshTaskConfigs,
  failRefreshTaskRun,
  updateSummaryJobStatus,
} from "../repositories/refresh-tasks";
import { markSummaryFailed, saveSummaryResult } from "../repositories/summaries";
import {
  ensurePersistedAITask,
  markAITaskRun,
  resolveAITask,
} from "./ai-task-settings";

function nowIso() {
  return new Date().toISOString();
}

function text(value: unknown, max = 20_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function texts(value: unknown, max = 100) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry, 2_000)).filter(Boolean).slice(0, max)
    : [];
}

function parseJsonText(value: string) {
  return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

function managedTaskKeyForLocalJob(job: Record<string, any>): AITaskKey | null {
  if (job.job_type === "managed_ai_task") {
    const request = parseJson<Record<string, any>>(job.request_json, {});
    return typeof request.aiTaskKey === "string"
      ? request.aiTaskKey as AITaskKey
      : null;
  }
  if (job.job_type === "deep_analysis") {
    return aiTaskKeyForFeature(
      job.subject_kind === "issue" ? "issue_deep_analysis" : "pr_deep_analysis",
      job.repo_scope,
    );
  }
  if (job.job_type === "repository_chat") return "repository_code_chat";
  if (job.job_type === "insight_evidence") return "local_code_insight";
  return null;
}

export async function enqueueManagedAITask(
  env: WorkerEnv,
  input: {
    userId: string;
    taskKey: AITaskKey;
    purpose: string;
    subjectKind: string;
    subjectKey: string;
    repoScope: string;
    targetRef?: string;
    baseSha?: string | null;
    headSha?: string | null;
    itemId?: string | null;
    chatThreadId?: string | null;
    priority?: number;
    request: Record<string, unknown>;
  },
) {
  const { settings } = await requireAvailableRunner(env, input.userId);
  const task = await resolveAITask(env, input.userId, input.taskKey);
  if (task.executionMode !== "opencode") {
    throw new HttpError(409, `${task.definition.name} 当前不是 OpenCode 执行方式`);
  }
  await ensurePersistedAITask(env, input.userId, task);
  const job = await enqueueLocalAnalysisJob(env, {
    id: crypto.randomUUID(),
    userId: input.userId,
    jobType: "managed_ai_task",
    subjectKind: input.subjectKind,
    subjectKey: input.subjectKey,
    repoScope: input.repoScope,
    itemId: input.itemId ?? null,
    chatThreadId: input.chatThreadId ?? null,
    sessionScope: `managed:${input.taskKey}:${input.subjectKey}:${Date.now()}`,
    baseSha: input.baseSha ?? null,
    headSha: input.headSha ?? null,
    targetRef: input.targetRef || input.headSha || "HEAD",
    providerId: task.opencodeProviderId || settings?.default_provider || "",
    modelId: task.opencodeModelId || settings?.default_model || "",
    priority: input.priority ?? 60,
    request: {
      aiTaskKey: input.taskKey,
      purpose: input.purpose,
      prompt: {
        type: task.definition.featureKey,
        version: task.prompt.promptVersion,
        templateId: task.prompt.templateId,
        templateName: task.prompt.name,
        revision: task.prompt.revision,
        systemContract: task.prompt.systemContract,
        instruction: task.prompt.instruction,
      },
      ...input.request,
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
      autoFetch: Boolean(settings?.auto_fetch),
    },
  });
  await markAITaskRun(env, input.userId, input.taskKey, "queued");
  return mapLocalJob(job!);
}

export function sameChatCodeContext(
  thread: { repo_scope?: string; target_ref?: string },
  repoScope: string,
  targetRef: string,
) {
  return (thread.repo_scope || "") === repoScope &&
    (thread.target_ref || "HEAD") === targetRef;
}

export function mapLocalJob(row: Record<string, any>) {
  return {
    id: row.id,
    jobType: row.job_type,
    subjectKind: row.subject_kind,
    subjectKey: row.subject_key,
    repoScope: row.repo_scope,
    itemId: row.item_id ?? null,
    chatThreadId: row.chat_thread_id ?? null,
    analysisDocumentId: row.analysis_document_id ?? null,
    sessionScope: row.session_scope,
    baseSha: row.base_sha ?? null,
    headSha: row.head_sha ?? null,
    targetRef: row.target_ref,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    localEvidence: Boolean(row.local_evidence),
    error: row.error ?? null,
    result: parseJson(row.result_json, {}),
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    updatedAt: row.updated_at,
  };
}

export function mapLocalEvent(row: Record<string, any>) {
  return {
    id: Number(row.id),
    jobId: row.job_id,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    source: row.source,
    level: row.level,
    message: row.message,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

async function requireAvailableRunner(env: WorkerEnv, userId: string) {
  const [settings, runner] = await Promise.all([
    ensureLocalRunnerSettings(env, userId),
    latestLocalRunner(env),
  ]);
  if (!settings?.enabled) {
    throw new HttpError(503, "本地分析 Runner 未启用，请先在设置中启用");
  }
  if (!runner || !runnerIsOnline(runner.last_seen_at)) {
    throw new HttpError(503, "本地分析 Runner 离线，无法启动 OpenCode 任务");
  }
  if (!runner.readonly_verified) {
    throw new HttpError(503, "本地 Runner 尚未通过只读权限检查");
  }
  return { settings, runner };
}

export async function localRunnerSettingsState(env: WorkerEnv, userId: string) {
  const [settings, runner] = await Promise.all([
    ensureLocalRunnerSettings(env, userId),
    latestLocalRunner(env),
  ]);
  return {
    settings: {
      enabled: Boolean(settings?.enabled),
      defaultProvider: settings?.default_provider || "",
      defaultModel: settings?.default_model || "",
      maxConcurrency: Number(settings?.max_concurrency ?? 1),
      worktreeRetentionHours: Number(settings?.worktree_retention_hours ?? 24),
      autoFetch: Boolean(settings?.auto_fetch),
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
    },
    runner: publicRunnerState(runner),
  };
}

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
  const { settings } = await requireAvailableRunner(env, input.userId);
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
  if (task.executionMode !== "opencode") {
    throw new HttpError(409, "该深度分析任务当前不是 OpenCode 执行方式");
  }
  await ensurePersistedAITask(env, input.userId, task);
  const prompt = task.prompt;
  const sessionScope = `community:${input.repo}:${input.kind}:${input.number}`;
  const versionKey = input.kind === "pr"
    ? row.head_sha || row.content_version || row.body_hash
    : row.body_hash || row.updated_at;
  const [binding, previousBinding] = await Promise.all([
    findSessionBinding(env, input.userId, sessionScope, versionKey),
    latestSessionBinding(env, input.userId, sessionScope),
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
    subjectKind: input.kind,
    subjectKey: `${input.repo}:${input.kind}:${input.number}`,
    repoScope: input.repo,
    itemId: row.id,
    sessionScope,
    baseSha: row.base_sha ?? null,
    headSha: row.head_sha ?? null,
    targetRef: row.head_sha || "HEAD",
    providerId: task.opencodeProviderId || settings?.default_provider || "",
    modelId: task.opencodeModelId || settings?.default_model || "",
    opencodeSessionId: binding?.opencode_session_id ?? null,
    priority: 100,
    request: {
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
  if (task.executionMode === "opencode") {
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

export async function enqueueRepositoryChat(
  env: WorkerEnv,
  input: {
    userId: string;
    threadId: string;
    content: string;
    repoScope: string;
    targetRef: string;
    providerId: string;
    modelId: string;
    pageContext: string;
    selection: string;
    taskKey?: "chat_assistant" | "repository_code_chat";
  },
) {
  const { settings } = await requireAvailableRunner(env, input.userId);
  const task = await resolveAITask(
    env,
    input.userId,
    input.taskKey || "repository_code_chat",
  );
  if (task.executionMode !== "opencode") {
    throw new HttpError(409, `${task.definition.name} 必须选择 OpenCode 执行方式`);
  }
  await ensurePersistedAITask(env, input.userId, task);
  const prompt = task.prompt;
  const thread = await findThreadRow(env, input.threadId, input.userId);
  if (!thread) throw new HttpError(404, "对话不存在");
  const sessionScope = `chat:${input.threadId}`;
  const binding = await latestSessionBinding(env, input.userId, sessionScope);
  const requestedRef = input.targetRef || "HEAD";
  const sameCodeContext = sameChatCodeContext(thread, input.repoScope, requestedRef);
  const jobId = crypto.randomUUID();
  const userMessageId = crypto.randomUUID();
  const createdAt = nowIso();
  await createMessageRow(env, {
    id: userMessageId,
    threadId: input.threadId,
    role: "user",
    contentMd: input.content,
    context: {
      mode: "repository",
      repoScope: input.repoScope,
      targetRef: input.targetRef,
      pageContext: input.pageContext,
      selection: input.selection,
    },
    createdAt,
  });
  const job = await enqueueLocalAnalysisJob(env, {
    id: jobId,
    userId: input.userId,
    jobType: "repository_chat",
    subjectKind: "chat",
    subjectKey: input.threadId,
    repoScope: input.repoScope,
    chatThreadId: input.threadId,
    sessionScope,
    targetRef: requestedRef,
    providerId: task.opencodeProviderId || settings?.default_provider || "",
    modelId: task.opencodeModelId || settings?.default_model || "",
    opencodeSessionId: sameCodeContext
      ? binding?.opencode_session_id ?? thread.opencode_session_id ?? null
      : null,
    priority: 80,
    request: {
      prompt: {
        type: "repository-code-chat",
        version: prompt.promptVersion,
        templateId: prompt.templateId,
        templateName: prompt.name,
        revision: prompt.revision,
        systemContract: prompt.systemContract,
        instruction: prompt.instruction,
      },
      question: input.content,
      pageContext: input.pageContext,
      selection: input.selection,
      repoScope: input.repoScope,
      targetRef: requestedRef,
      previousMemory: binding
        ? {
            summaryMd: binding.summary_md,
            confirmedFacts: parseJson(binding.confirmed_facts_json, []),
            unresolved: parseJson(binding.unresolved_json, []),
            focus: parseJson(binding.focus_json, []),
          }
        : null,
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
      autoFetch: Boolean(settings?.auto_fetch),
    },
  });
  await updateThreadLocalAnalysisState(env, {
    threadId: input.threadId,
    mode: "repository",
    repoScope: input.repoScope,
    targetRef: requestedRef,
    providerId: task.opencodeProviderId,
    modelId: task.opencodeModelId,
    runnerJobId: jobId,
  });
  await markAITaskRun(env, input.userId, task.key, "queued");
  return {
    job: mapLocalJob(job!),
    userMessage: {
      id: userMessageId,
      role: "user",
      contentMd: input.content,
      context: { mode: "repository" },
      createdAt,
    },
  };
}

export async function enqueueInsightLocalEvidence(
  env: WorkerEnv,
  input: {
    userId: string;
    scope: string;
    title: string;
    targets: unknown[];
    providerId?: string;
    modelId?: string;
  },
) {
  const { settings } = await requireAvailableRunner(env, input.userId);
  const task = await resolveAITask(env, input.userId, "local_code_insight");
  if (task.executionMode !== "opencode") {
    throw new HttpError(409, "本地代码证据洞察必须选择 OpenCode 执行方式");
  }
  await ensurePersistedAITask(env, input.userId, task);
  const prompt = task.prompt;
  if (!input.targets.length) {
    throw new HttpError(400, "使用本地代码证据时至少选择一个社区事项或领域");
  }
  const job = await enqueueLocalAnalysisJob(env, {
    id: crypto.randomUUID(),
    userId: input.userId,
    jobType: "insight_evidence",
    subjectKind: "insight",
    subjectKey: input.scope,
    repoScope: input.scope,
    sessionScope: `insight:${input.scope}:${Date.now()}`,
    targetRef: "HEAD",
    providerId: task.opencodeProviderId || settings?.default_provider || "",
    modelId: task.opencodeModelId || settings?.default_model || "",
    priority: 70,
    request: {
      prompt: {
        type: "local-code-insight",
        version: prompt.promptVersion,
        templateId: prompt.templateId,
        templateName: prompt.name,
        revision: prompt.revision,
        systemContract: prompt.systemContract,
        instruction: prompt.instruction,
      },
      title: input.title,
      scope: input.scope,
      targets: input.targets.slice(0, 20),
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
      autoFetch: Boolean(settings?.auto_fetch),
    },
  });
  await markAITaskRun(env, input.userId, task.key, "queued");
  return mapLocalJob(job!);
}

export async function enqueueRunnerAction(
  env: WorkerEnv,
  input: {
    userId: string;
    jobType: Extract<LocalJobType,
      "runner_check" | "repository_check" | "repository_clone" | "provider_refresh" | "worktree_cleanup">;
    repoScope?: string;
  },
) {
  const settings = await ensureLocalRunnerSettings(env, input.userId);
  const runner = await latestLocalRunner(env);
  if (!runner || !runnerIsOnline(runner.last_seen_at)) {
    throw new HttpError(503, "本地 Runner 离线，无法执行该操作");
  }
  const job = await enqueueLocalAnalysisJob(env, {
    id: crypto.randomUUID(),
    userId: input.userId,
    jobType: input.jobType,
    subjectKind: "runner",
    subjectKey: input.repoScope || "all",
    repoScope: input.repoScope || "all",
    sessionScope: `runner:${input.jobType}:${Date.now()}`,
    request: {
      repository: input.repoScope || "all",
      worktreeRetentionHours: Number(settings?.worktree_retention_hours ?? 24),
    },
    priority: 110,
  });
  return mapLocalJob(job!);
}

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
  const managedTaskKey = managedTaskKeyForLocalJob(job);
  if (input.status !== "completed") {
    const failedSessionId = text(input.result?.opencodeSessionId, 200);
    const failedCommits = input.result?.resolvedCommits && typeof input.result.resolvedCommits === "object"
      ? input.result.resolvedCommits as Record<string, string>
      : {};
    const failedCommit = text(failedCommits[job.repo_scope] || job.head_sha || "", 100);
    if (failedSessionId && failedCommit && job.session_scope) {
      await upsertSessionBinding(env, {
        id: crypto.randomUUID(),
        userId: job.user_id,
        sessionScope: job.session_scope,
        repoScope: job.repo_scope,
        commitSha: failedCommit,
        opencodeSessionId: failedSessionId,
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
      result: failedSessionId ? { opencodeSessionId: failedSessionId, commitSha: failedCommit } : {},
      error: input.error || (input.status === "cancelled" ? "任务已取消" : "本地分析失败"),
      localEvidence: false,
      opencodeSessionId: failedSessionId || null,
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
      const message = input.error || "OpenCode 摘要任务未完成";
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
        (input.error || "OpenCode 分类补判未完成").slice(0, 500),
      );
    }
    if (job.job_type === "managed_ai_task" && request.purpose === "taxonomy_refresh") {
      await failClassificationTaxonomyRefresh(env, {
        userId: job.user_id,
        repoId: text(request.repoId, 80),
        error: (input.error || "OpenCode 分类标准更新未完成").slice(0, 500),
        now: nowIso(),
      });
    }
    if (managedTaskKey) {
      await markAITaskRun(
        env,
        job.user_id,
        managedTaskKey,
        "failed",
        input.error || "OpenCode 任务未完成",
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
  const sessionId = text(result.opencodeSessionId, 200);
  const providerId = text(result.providerId, 200) || job.provider_id;
  const modelId = text(result.modelId, 300) || job.model_id;
  const commitSha = text(
    resolvedCommits[job.repo_scope] || result.commitSha || job.head_sha || job.target_ref,
    100,
  );
  let analysisDocumentId: string | null = null;

  if (job.job_type === "deep_analysis") {
    const current = await findCommunityRow(
      env,
      job.repo_scope,
      job.subject_kind,
      Number(request.number),
    );
    const versionCurrent = analysisVersionMatches(
      current
        ? { headSha: current.head_sha, bodyHash: current.body_hash, filesHash: current.files_hash }
        : null,
      {
        headSha: job.head_sha,
        bodyHash: request.analyzedVersion?.bodyHash || "",
        filesHash: request.analyzedVersion?.filesHash || "",
      },
    );
    analysisDocumentId = crypto.randomUUID();
    const createdAt = nowIso();
    const reportMd = text(result.reportMd, 500_000);
    if (!reportMd) throw new HttpError(400, "OpenCode 未返回最终深度分析报告");
    await createLocalAnalysisDocumentRow(env, {
      id: analysisDocumentId,
      type: job.subject_kind,
      scope: job.subject_key,
      title: `${request.evidence?.title || job.subject_key} · OpenCode 深度分析`,
      summaryMd: text(result.summaryMd, 2_000) || reportMd.slice(0, 1_000),
      contentMd: reportMd,
      prompt: request.prompt?.instruction || "",
      promptTemplateId: request.prompt?.templateId || null,
      promptTemplateName: request.prompt?.templateName || "",
      promptRevision: Number(request.prompt?.revision ?? 1),
      model: modelId,
      baseSha: job.base_sha ?? null,
      headSha: job.head_sha ?? null,
      bodyHash: request.analyzedVersion?.bodyHash || "",
      filesHash: request.analyzedVersion?.filesHash || "",
      promptType: request.prompt?.type || "",
      promptVersion: request.prompt?.version || "",
      provider: providerId,
      versionStatus: versionCurrent ? "current" : "outdated",
      userId: job.user_id,
      codeReferences,
      evidenceCompleteness: localEvidence ? "complete" : "partial",
      opencodeSessionId: sessionId || null,
      runnerJobId: job.id,
      localEvidence,
      createdAt,
    });
    if (versionCurrent && job.item_id) {
      await updateCommunityDeepAnalysisStatusForVersion(env, {
        itemId: job.item_id,
        status: "ready",
        headSha: job.head_sha,
        bodyHash: current?.body_hash || "",
        filesHash: current?.files_hash || "",
      });
    } else if (job.item_id) {
      await markCommunityDeepAnalysisOutdatedIfRunning(env, job.item_id);
    }
    if (request.refreshRunId) {
      await completeRefreshTaskRun(env, {
        runId: request.refreshRunId,
        userId: job.user_id,
        repoId: job.repo_scope,
        taskType: "deep_analysis",
        itemCount: 1,
      });
    }
  } else if (job.job_type === "repository_chat" && job.chat_thread_id) {
    const answerMd = text(result.answerMd || result.reportMd, 200_000);
    if (!answerMd) throw new HttpError(400, "OpenCode 未返回仓库问答内容");
    const assistantAt = nowIso();
    await createMessageRow(env, {
      id: crypto.randomUUID(),
      threadId: job.chat_thread_id,
      role: "assistant",
      contentMd: answerMd,
      context: {
        mode: "repository",
        providerId,
        modelId,
        opencodeSessionId: sessionId,
        commitSha,
        localEvidence,
        codeReferences,
        runnerJobId: job.id,
      },
      createdAt: assistantAt,
    });
    await touchThreadRow(env, job.chat_thread_id, text(request.question, 50), assistantAt);
    await updateThreadLocalAnalysisState(env, {
      threadId: job.chat_thread_id,
      mode: "repository",
      repoScope: job.repo_scope,
      targetRef: job.target_ref,
      providerId,
      modelId,
      sessionId,
      commitSha,
      runnerJobId: null,
      localEvidence,
    });
  } else if (job.job_type === "insight_evidence") {
    const reportMd = text(result.reportMd, 500_000);
    if (!reportMd) throw new HttpError(400, "OpenCode 未返回本地代码洞察报告");
    analysisDocumentId = crypto.randomUUID();
    const createdAt = nowIso();
    await createLocalAnalysisDocumentRow(env, {
      id: analysisDocumentId,
      type: "insight",
      scope: job.repo_scope,
      title: text(request.title, 200) || "包含本地代码证据的 AI 洞察",
      summaryMd: text(result.summaryMd, 2_000) || reportMd.slice(0, 1_000),
      contentMd: reportMd,
      prompt: text(request.prompt?.instruction, 8_000),
      promptTemplateId: text(request.prompt?.templateId, 200) || null,
      promptTemplateName: text(request.prompt?.templateName, 200) || "本地代码证据洞察",
      promptRevision: Number(request.prompt?.revision ?? 1),
      model: modelId,
      baseSha: null,
      headSha: commitSha || null,
      bodyHash: "",
      filesHash: "",
      promptType: "local-code-insight",
      promptVersion: text(request.prompt?.version, 200) || "local-code-insight-v2",
      provider: providerId,
      versionStatus: "current",
      userId: job.user_id,
      codeReferences,
      evidenceCompleteness: localEvidence ? "complete" : "partial",
      opencodeSessionId: sessionId || null,
      runnerJobId: job.id,
      localEvidence,
      createdAt,
    });
  } else if (job.job_type === "managed_ai_task") {
    const outputText = text(result.outputText || result.reportMd, 500_000);
    if (!outputText) throw new HttpError(400, "OpenCode 未返回 AI 任务输出");
    if (request.purpose === "community_summary" && job.item_id) {
      const context = request.analysisContext || {};
      const validation = job.subject_kind === "pr"
        ? validatePrSummaryOutput(outputText, context)
        : validateIssueSummaryOutput(outputText);
      if (!validation.ok) {
        throw new HttpError(400, `OpenCode 摘要结构校验失败：${validation.error}`);
      }
      const version = request.version || {};
      const generatedAt = nowIso();
      const write = await saveSummaryResult(env, {
        itemId: job.item_id,
        summary: validation.value.summary,
        headSha: text(version.headSha, 200) || null,
        bodyHash: text(version.bodyHash, 200),
        filesHash: text(version.filesHash, 200),
        promptVersion: text(request.prompt?.version, 200),
        promptType: text(context.promptType, 100),
        model: modelId,
        provider: `OpenCode/${providerId || "default"}`,
        structured: validation.value,
        evidenceCompleteness: "evidenceCompleteness" in validation.value
          ? validation.value.evidenceCompleteness
          : text(context.evidenceCompleteness, 80) || "partial",
        templateId: text(request.prompt?.templateId, 200),
        revision: Number(request.prompt?.revision ?? 1),
        generatedAt,
        evidence: texts(context.evidence, 200),
      });
      if (Number((write as any)?.meta?.changes ?? 1) === 0) {
        throw new HttpError(409, "条目版本已变化，OpenCode 摘要结果未写入");
      }
      if (request.summaryJobId) {
        await updateSummaryJobStatus(env, request.summaryJobId, "ready");
      }
    } else if (request.purpose === "analysis_document") {
      analysisDocumentId = crypto.randomUUID();
      const createdAt = nowIso();
      await createLocalAnalysisDocumentRow(env, {
        id: analysisDocumentId,
        type: text(request.document?.type, 80) || "insight",
        scope: text(request.document?.scope, 120) || job.repo_scope,
        title: text(request.document?.title, 200) || job.subject_key,
        summaryMd: text(result.summaryMd, 2_000) || outputText.slice(0, 1_000),
        contentMd: outputText,
        prompt: text(request.prompt?.instruction, 8_000),
        promptTemplateId: text(request.prompt?.templateId, 200),
        promptTemplateName: text(request.prompt?.templateName, 200),
        promptRevision: Number(request.prompt?.revision ?? 1),
        model: modelId,
        baseSha: job.base_sha ?? null,
        headSha: commitSha || job.head_sha || null,
        bodyHash: "",
        filesHash: "",
        promptType: text(request.prompt?.type, 100),
        promptVersion: text(request.prompt?.version, 200),
        provider: providerId,
        versionStatus: "current",
        userId: job.user_id,
        codeReferences,
        evidenceCompleteness: localEvidence ? "complete" : "partial",
        opencodeSessionId: sessionId || null,
        runnerJobId: job.id,
        localEvidence,
        createdAt,
      });
    } else if (request.purpose === "classification_supplement" && job.item_id) {
      const payload = parseJsonText(outputText) as Record<string, unknown>;
      const registered = new Set(texts(request.taxonomyDomains, 200));
      const domain = text(payload.domain, 160);
      if (!registered.has(domain)) {
        throw new HttpError(400, "OpenCode 返回了未注册技术类别");
      }
      const current = await findClassificationItemVersion(env, job.item_id);
      const version = request.version || {};
      if (
        !current || current.classification_locked ||
        (current.head_sha || "") !== (version.headSha || "") ||
        current.body_hash !== version.bodyHash ||
        current.files_hash !== version.filesHash
      ) {
        throw new HttpError(409, "条目版本或人工分类已变化，OpenCode 分类结果未写入");
      }
      const rule = request.ruleAssessment || {};
      const rawConfidence = Number(payload.confidence);
      const confidence = Number.isFinite(rawConfidence)
        ? Math.max(0.2, Math.min(0.9, rawConfidence))
        : Number(rule.confidence || 0.2);
      const evidence = texts(payload.mainEvidence, 8);
      const assessment = {
        ...rule,
        domain,
        source: "ai",
        confidence: Number(confidence.toFixed(2)),
        confidenceLabel: confidence >= 0.78 ? "high" : confidence >= 0.52 ? "medium" : "low",
        matchedTerms: [...new Set([...(Array.isArray(rule.matchedTerms) ? rule.matchedTerms : []), ...evidence])].slice(0, 12),
      };
      await saveClassificationResult(env, {
        itemId: job.item_id,
        domain,
        source: "ai",
        confidence: assessment.confidence,
        assessment,
        headSha: current.head_sha ?? null,
        bodyHash: current.body_hash,
        filesHash: current.files_hash,
        generatedAt: nowIso(),
        details: {
          primaryDomain: domain,
          candidates: Array.isArray(rule.scores) ? rule.scores.slice(0, 5) : [],
          taxonomyVersion: rule.taxonomyVersion || "",
          source: "ai",
          confidence: assessment.confidence,
          confidenceLabel: assessment.confidenceLabel,
          evidence: {
            paths: rule.matchedPaths || [],
            terms: assessment.matchedTerms,
            codeownerRules: rule.matchedCodeownerRules || [],
          },
          prompt: request.prompt || null,
          aiSupplementError: null,
          codeReferences,
        },
      });
    } else if (request.purpose === "taxonomy_refresh") {
      const repoId = text(request.repoId, 80);
      const taxonomy = getRepositoryTaxonomy(repoId);
      const payload = parseJsonText(outputText) as Record<string, unknown>;
      const overlay = validateTaxonomyOverlay(payload, taxonomy);
      const now = nowIso();
      await saveClassificationTaxonomyOverride(env, {
        userId: job.user_id,
        repoId,
        baseVersion: taxonomy.version,
        overlayVersion: overlay.version,
        overlayJson: JSON.stringify(overlay),
        analysisMd: typeof payload.analysisMarkdown === "string"
          ? payload.analysisMarkdown.slice(0, 60_000)
          : "# 分类标准刷新分析\n\n已通过 OpenCode 检查本地源码并应用受限增量规则。",
        promptTemplateId: text(request.prompt?.templateId, 200),
        promptTemplateName: text(request.prompt?.templateName, 200),
        promptRevision: Number(request.prompt?.revision ?? 1),
        promptVersion: text(request.prompt?.version, 200),
        provider: `OpenCode/${providerId || "default"}`,
        model: modelId,
        now,
      });
    } else if (request.purpose === "domain_snapshot") {
      const snapshot = request.snapshot || {};
      await saveDomainSnapshot(env, {
        id: text(snapshot.id, 200),
        domain: text(snapshot.domain, 160),
        date: text(snapshot.date, 40),
        architectureMd: text(snapshot.architectureMd, 200_000),
        changedPaths: texts(snapshot.changedPaths, 500),
        activity: snapshot.activity || {},
        insightMd: outputText,
        promptTemplateId: text(request.prompt?.templateId, 200),
        promptTemplateName: text(request.prompt?.templateName, 200),
        promptRevision: Number(request.prompt?.revision ?? 1),
        promptVersion: text(request.prompt?.version, 200),
        model: modelId,
        provider: `OpenCode/${providerId || "default"}`,
        generationSource: "opencode",
        createdAt: nowIso(),
      });
    }
  }

  if (sessionId && job.session_scope && commitSha) {
    await upsertSessionBinding(env, {
      id: crypto.randomUUID(),
      userId: job.user_id,
      sessionScope: job.session_scope,
      repoScope: job.repo_scope,
      commitSha,
      opencodeSessionId: sessionId,
      runnerId: input.runnerId,
      providerId,
      modelId,
      summaryMd: text(result.summaryMd, 20_000),
      confirmedFacts: texts(result.confirmedFacts),
      unresolved: texts(result.unresolvedIssues),
      focus: texts(result.focus),
    });
  }
  const runnerAction = [
    "runner_check",
    "repository_check",
    "repository_clone",
    "provider_refresh",
    "worktree_cleanup",
  ].includes(job.job_type);
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
    opencodeSessionId: sessionId || null,
    localEvidence,
    analysisDocumentId,
  });
  if (managedTaskKey) {
    await markAITaskRun(env, job.user_id, managedTaskKey, "ready");
  }
  return findLocalAnalysisJob(env, job.id);
}
