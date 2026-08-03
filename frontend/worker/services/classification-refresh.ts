import { executeResolvedAITask } from "./ai-execution";
import { parseJson, type WorkerEnv } from "../db";
import { classifyDomain } from "../domain/classification/classifier";
import { buildClassificationSystemPrompt } from "../domain/classification/prompt-builder";
import type {
  DomainAssessment,
  RepositoryTaxonomy,
} from "../domain/classification/types";
import type { PromptFeatureKey } from "../domain/prompt-catalog";
import { aiTaskKeyForFeature } from "../domain/ai-task-catalog";
import { shouldAutoClassify, type RefreshRule } from "../domain/refresh-policy";
import {
  findLinkedPullDomains,
  listClassificationCandidates,
  saveClassificationResult,
  markClassificationRunning,
} from "../repositories/classifications";
import { getEffectiveClassificationTaxonomy } from "./classification-taxonomies";
import { resolveAITask } from "./ai-task-settings";
import type { ResolvedPrompt } from "./prompt-resolution";
import { enqueueManagedAITask } from "./local-analysis";

function classificationPromptFeature(repoId: string): PromptFeatureKey {
  return repoId === "vllm-ascend" ? "vllm_ascend_classification" : "vllm_classification";
}

function stripFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function classificationDetails(
  assessment: DomainAssessment,
  prompt: ResolvedPrompt | null,
  aiSupplementError: string,
) {
  return {
    primaryDomain: assessment.domain,
    candidates: assessment.scores.slice(0, 5),
    taxonomyVersion: assessment.taxonomyVersion,
    source: assessment.source,
    confidence: assessment.confidence,
    confidenceLabel: assessment.confidenceLabel,
    evidence: {
      paths: assessment.matchedPaths,
      terms: assessment.matchedTerms,
      codeownerRules: assessment.matchedCodeownerRules,
    },
    prompt: prompt ? {
      templateId: prompt.templateId,
      name: prompt.name,
      revision: prompt.revision,
      version: prompt.promptVersion,
    } : null,
    aiSupplementError: aiSupplementError || null,
  };
}

async function supplementLowConfidenceClassification(
  env: WorkerEnv,
  input: {
    userId: string;
    repoId: string;
    taxonomy: RepositoryTaxonomy;
    row: Record<string, any>;
    files: Array<{ path: string; additions?: number; deletions?: number }>;
    labels: string[];
    ruleAssessment: DomainAssessment;
  },
) {
  if (input.ruleAssessment.confidenceLabel !== "low") {
    return { assessment: input.ruleAssessment, prompt: null, error: "", queued: false };
  }
  const task = await resolveAITask(
    env,
    input.userId,
    aiTaskKeyForFeature(classificationPromptFeature(input.repoId), input.repoId),
  );
  const prompt = task.prompt;
  if (task.executionMode === "opencode") {
    await enqueueManagedAITask(env, {
      userId: input.userId,
      taskKey: task.key,
      purpose: "classification_supplement",
      subjectKind: input.row.kind,
      subjectKey: `${input.repoId}:${input.row.kind}:${input.row.number}`,
      repoScope: input.repoId,
      targetRef: input.row.head_sha || "HEAD",
      headSha: input.row.head_sha ?? null,
      itemId: input.row.id,
      request: {
        taxonomyDomains: input.taxonomy.domains.map((domain) => domain.name),
        ruleAssessment: input.ruleAssessment,
        evidence: {
          title: input.row.title,
          body: String(input.row.body_md ?? "").slice(0, 16_000),
          labels: input.labels,
          files: input.files.slice(0, 300),
        },
        version: {
          headSha: input.row.head_sha ?? null,
          bodyHash: input.row.body_hash,
          filesHash: input.row.files_hash,
        },
      },
    });
    return {
      assessment: input.ruleAssessment,
      prompt,
      error: "OpenCode 低置信度补判已排队",
      queued: true,
    };
  }
  try {
    const fallback = JSON.stringify({
      domain: input.ruleAssessment.domain,
      confidence: input.ruleAssessment.confidence,
      mainEvidence: [],
      reason: "未配置 AI，保留规则结果",
    });
    const result = await executeResolvedAITask(env, {
      userId: input.userId,
      task,
      messages: [
        { role: "system", content: buildClassificationSystemPrompt(input.taxonomy) },
        { role: "user", content: `当前启用要求（${prompt.name} · r${prompt.revision}）：\n${prompt.instruction}\n\n条目：\n${JSON.stringify({
          repository: input.repoId,
          kind: input.row.kind,
          title: input.row.title,
          body: String(input.row.body_md ?? "").slice(0, 16_000),
          labels: input.labels,
          files: input.files.slice(0, 300),
          ruleResult: input.ruleAssessment,
        })}` },
      ],
      fallback,
    });
    if (result.provider !== "api") {
      return { assessment: input.ruleAssessment, prompt, error: "", queued: false };
    }
    const payload = JSON.parse(stripFence(result.content)) as Record<string, unknown>;
    const registered = new Set(input.taxonomy.domains.map((domain) => domain.name));
    const domain = typeof payload.domain === "string" ? payload.domain : "";
    if (!registered.has(domain)) {
      return { assessment: input.ruleAssessment, prompt, error: "AI 返回了未注册类别，已保留规则结果", queued: false };
    }
    const rawConfidence = Number(payload.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0.2, Math.min(0.9, rawConfidence))
      : input.ruleAssessment.confidence;
    const evidence = Array.isArray(payload.mainEvidence)
      ? payload.mainEvidence.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
      : [];
    return {
      prompt,
      error: "",
      queued: false,
      assessment: {
        ...input.ruleAssessment,
        domain,
        source: "ai" as const,
        confidence: Number(confidence.toFixed(2)),
        confidenceLabel: confidence >= 0.78 ? "high" as const : confidence >= 0.52 ? "medium" as const : "low" as const,
        matchedTerms: [...new Set([...input.ruleAssessment.matchedTerms, ...evidence])].slice(0, 12),
      },
    };
  } catch (error) {
    return {
      assessment: input.ruleAssessment,
      prompt,
      error: error instanceof Error ? error.message : "低置信度 AI 补判失败",
      queued: false,
    };
  }
}

export async function refreshCommunityClassifications(
  env: WorkerEnv,
  input: {
    userId: string;
    repoId: string;
    refreshRule: RefreshRule;
    maxItems: number;
    itemId?: string | null;
    forceManual?: boolean;
  },
) {
  const automaticPredicate = input.refreshRule === "first_only"
    ? "classification_status IN ('missing', 'failed')"
    : input.refreshRule === "code_only"
      ? `(classification_status IN ('missing', 'failed') OR (
          classification_status = 'possibly_stale' AND kind = 'pr' AND (
            COALESCE(classification_head_sha, '') != COALESCE(head_sha, '')
            OR classification_files_hash != files_hash
          )
        ))`
      : input.refreshRule === "any_update"
        ? "classification_status IN ('missing', 'possibly_stale', 'failed')"
        : "0";
  const rows = await listClassificationCandidates(env, {
    repoId: input.repoId,
    itemId: input.itemId,
    maxItems: input.maxItems,
    predicate: input.forceManual ? "1" : automaticPredicate,
  });
  const taxonomy = await getEffectiveClassificationTaxonomy(
    env,
    input.userId,
    input.repoId,
  );
  let classified = 0;
  for (const row of rows) {
    const shouldRun = input.forceManual || shouldAutoClassify(input.refreshRule, {
      missing: row.classification_status === "missing",
      codeChanged: row.kind === "pr" && (
        (row.classification_head_sha ?? "") !== (row.head_sha ?? "") ||
        row.classification_files_hash !== row.files_hash
      ),
      updatedAtChanged: row.classification_status === "possibly_stale" && (
        !row.classification_generated_at || !row.any_changed_at ||
        row.any_changed_at > row.classification_generated_at
      ),
      locked: Boolean(row.classification_locked),
    });
    if (!shouldRun) continue;
    const diff = parseJson<Record<string, any>>(row.diff_json, {});
    const files = Array.isArray(diff.entries) ? diff.entries : [];
    const labels = parseJson<string[]>(row.labels_json, []);
    const linkedDomains = row.kind === "issue"
      ? await findLinkedPullDomains(env, input.repoId, String(row.body_md ?? ""))
      : [];
    const ruleAssessment = classifyDomain({
      repoId: input.repoId,
      kind: row.kind,
      title: row.title,
      body: row.body_md,
      files,
      labels,
      linkedDomains,
      taxonomy,
    });
    const supplemented = await supplementLowConfidenceClassification(env, {
      userId: input.userId,
      repoId: input.repoId,
      taxonomy,
      row,
      files,
      labels,
      ruleAssessment,
    });
    const assessment = supplemented.assessment;
    const now = new Date().toISOString();
    await saveClassificationResult(env, {
      itemId: row.id,
      domain: assessment.domain,
      source: assessment.source,
      confidence: assessment.confidence,
      assessment,
      headSha: row.head_sha ?? null,
      bodyHash: row.body_hash,
      filesHash: row.files_hash,
      generatedAt: now,
      details: classificationDetails(
        assessment,
        supplemented.prompt,
        supplemented.error,
      ),
    });
    if (supplemented.queued) await markClassificationRunning(env, row.id);
    classified += 1;
  }
  return { itemCount: classified, classified };
}
