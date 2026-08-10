import type { WorkerEnv } from "../../db";
import { getRepositoryTaxonomy } from "../../domain/classification/registry";
import { validateTaxonomyOverlay } from "../../domain/classification/taxonomy-overlay";
import {
  analysisVersionMatches,
  validateIssueSummaryOutput,
  validatePrSummaryOutput,
} from "../../domain/analysis-quality";
import { normalizeCodeReferences } from "../../domain/local-analysis";
import { HttpError } from "../../http";
import { createMessageRow, touchThreadRow } from "../../repositories/chat";
import {
  findCommunityRow,
  markCommunityDeepAnalysisOutdatedIfRunning,
  updateCommunityDeepAnalysisStatusForVersion,
} from "../../repositories/community";
import { saveDomainSnapshot } from "../../repositories/domain-maps";
import {
  findClassificationItemVersion,
  markClassificationFailed,
  saveClassificationResult,
} from "../../repositories/classifications";
import {
  saveClassificationTaxonomyOverride,
} from "../../repositories/classification-taxonomies";
import {
  createLocalAnalysisDocumentRow,
  updateThreadLocalAnalysisState,
} from "../../repositories/local-runner";
import {
  completeRefreshTaskRun,
  updateSummaryJobStatus,
} from "../../repositories/refresh-tasks";
import { saveSummaryResult } from "../../repositories/summaries";

import {
  nowIso,
  parseJsonText,
  text,
  texts,
} from "./helpers";

export type CompletionHandlerContext = {
  env: WorkerEnv;
  job: Record<string, any>;
  request: Record<string, any>;
  result: Record<string, any>;
  agentName: string;
  codeReferences: ReturnType<typeof normalizeCodeReferences>;
  localEvidence: boolean;
  sessionId: string;
  providerId: string;
  modelId: string;
  commitSha: string;
};

type CompletionHandler = (context: CompletionHandlerContext) => Promise<string | null>;

async function handleDeepAnalysis(context: CompletionHandlerContext) {
  const { env, job, request, result, agentName, codeReferences, localEvidence, sessionId, providerId, modelId, commitSha } = context;
  let analysisDocumentId: string | null = null;
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
  if (!reportMd) throw new HttpError(400, `${agentName} 未返回最终深度分析报告`);
  await createLocalAnalysisDocumentRow(env, {
    id: analysisDocumentId,
    type: job.subject_kind,
    scope: job.subject_key,
    title: `${request.evidence?.title || job.subject_key} · ${agentName} 深度分析`,
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
    agentSessionId: sessionId || null,
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
  return analysisDocumentId;
}

async function handleRepositoryChat(context: CompletionHandlerContext) {
  const { env, job, request, result, agentName, codeReferences, localEvidence, sessionId, providerId, modelId, commitSha } = context;
  let analysisDocumentId: string | null = null;
  const answerMd = text(result.answerMd || result.reportMd, 200_000);
  if (!answerMd) throw new HttpError(400, `${agentName} 未返回仓库问答内容`);
  const assistantAt = nowIso();
  await createMessageRow(env, {
    id: crypto.randomUUID(),
    threadId: job.chat_thread_id,
    role: "assistant",
    contentMd: answerMd,
    context: {
      mode: "repository",
      executionMode: job.engine_id,
      providerId,
      modelId,
      promptTemplateName: text(request.prompt?.templateName, 200),
      promptVersion: text(request.prompt?.version, 200),
      promptRevision: Number(request.prompt?.revision ?? 1),
      agentSessionId: sessionId,
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
    agentSessionId: sessionId,
    commitSha,
    runnerJobId: null,
    localEvidence,
  });
  return analysisDocumentId;
}

async function handleInsightEvidence(context: CompletionHandlerContext) {
  const { env, job, request, result, agentName, codeReferences, localEvidence, sessionId, providerId, modelId, commitSha } = context;
  let analysisDocumentId: string | null = null;
  const reportMd = text(result.reportMd, 500_000);
  if (!reportMd) throw new HttpError(400, `${agentName} 未返回本地代码洞察报告`);
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
    agentSessionId: sessionId || null,
    runnerJobId: job.id,
    localEvidence,
    createdAt,
  });
  return analysisDocumentId;
}

async function handleManagedAITask(context: CompletionHandlerContext) {
  const { env, job, request, result, agentName, codeReferences, localEvidence, sessionId, providerId, modelId, commitSha } = context;
  let analysisDocumentId: string | null = null;
  const outputText = text(result.outputText || result.reportMd, 500_000);
  if (!outputText) throw new HttpError(400, `${agentName} 未返回 AI 任务输出`);
  if (request.purpose === "community_summary" && job.item_id) {
    const context = request.analysisContext || {};
    const validation = job.subject_kind === "pr"
      ? validatePrSummaryOutput(outputText, context)
      : validateIssueSummaryOutput(outputText);
    if (!validation.ok) {
      throw new HttpError(400, `${agentName} 摘要结构校验失败：${validation.error}`);
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
      provider: `${agentName}/${providerId || "default"}`,
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
      throw new HttpError(409, `条目版本已变化，${agentName} 摘要结果未写入`);
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
      agentSessionId: sessionId || null,
      runnerJobId: job.id,
      localEvidence,
      createdAt,
    });
  } else if (request.purpose === "classification_supplement" && job.item_id) {
    const payload = parseJsonText(outputText) as Record<string, unknown>;
    const registered = new Set(texts(request.taxonomyDomains, 200));
    const domain = text(payload.domain, 160);
    if (!registered.has(domain)) {
      throw new HttpError(400, `${agentName} 返回了未注册技术类别`);
    }
    const current = await findClassificationItemVersion(env, job.item_id);
    const version = request.version || {};
    if (
      !current || current.classification_locked ||
      (current.head_sha || "") !== (version.headSha || "") ||
      current.body_hash !== version.bodyHash ||
      current.files_hash !== version.filesHash
    ) {
      throw new HttpError(409, `条目版本或人工分类已变化，${agentName} 分类结果未写入`);
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
        : `# 分类标准刷新分析\n\n已通过 ${agentName} 检查本地源码并应用受限增量规则。`,
      promptTemplateId: text(request.prompt?.templateId, 200),
      promptTemplateName: text(request.prompt?.templateName, 200),
      promptRevision: Number(request.prompt?.revision ?? 1),
      promptVersion: text(request.prompt?.version, 200),
      provider: `${agentName}/${providerId || "default"}`,
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
      provider: `${agentName}/${providerId || "default"}`,
      generationSource: "local_agent",
      createdAt: nowIso(),
    });
  }  return analysisDocumentId;
}

const COMPLETION_HANDLERS: Readonly<Partial<Record<string, CompletionHandler>>> = {
deep_analysis: handleDeepAnalysis,
repository_chat: handleRepositoryChat,
insight_evidence: handleInsightEvidence,
managed_ai_task: handleManagedAITask,
};

export async function persistCompletedBusinessResult(context: CompletionHandlerContext) {
const handler = COMPLETION_HANDLERS[context.job.job_type];
return handler ? handler(context) : null;
}
