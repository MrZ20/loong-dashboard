import { executeResolvedAITask } from "./ai-execution";
import type { WorkerEnv } from "../db";
import { parseJson } from "../mappers/database-row";
import { buildClassificationSystemPrompt } from "../domain/classification/prompt-builder";
import {
  applyTaxonomyOverlay,
  getRepositoryTaxonomy,
  normalizeRepositoryTaxonomyId,
} from "../domain/classification/registry";
import type {
  RepositoryTaxonomy,
  TaxonomyOverlay,
} from "../domain/classification/types";
import { validateTaxonomyOverlay } from "../domain/classification/taxonomy-overlay";
import type { PromptFeatureKey } from "../domain/prompt-catalog";
import { aiTaskKeyForFeature } from "../domain/ai-task-catalog";
import { HttpError } from "../http";
import {
  failClassificationTaxonomyRefresh,
  findClassificationTaxonomyOverride,
  listClassificationTaxonomySamples,
  markClassificationTaxonomyRunning,
  saveClassificationTaxonomyOverride,
} from "../repositories/classification-taxonomies";
import { resolveAITask } from "./ai-task-settings";
import { enqueueManagedAITask } from "./local-runtime/enqueue";
import { findActiveLocalAnalysisJob } from "../repositories/local-runner";
import { mapLocalJob } from "./local-runtime/mappers";

function promptFeature(repoId: string): PromptFeatureKey {
  return repoId === "vllm-ascend" ? "vllm_ascend_taxonomy_refresh" : "vllm_taxonomy_refresh";
}

function stripFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function mapState(taxonomy: RepositoryTaxonomy, row: Awaited<ReturnType<typeof findClassificationTaxonomyOverride>>) {
  const overlay = parseJson<TaxonomyOverlay | null>(row?.overlay_json, null);
  const effective = applyTaxonomyOverlay(taxonomy, overlay);
  return {
    repoId: taxonomy.repoId,
    repositoryName: taxonomy.name,
    baseVersion: taxonomy.version,
    effectiveVersion: effective.version,
    evidenceRevision: taxonomy.evidenceRevision,
    status: row?.status ?? "ready",
    lastRefreshedAt: row?.last_refreshed_at ?? null,
    lastError: row?.last_error ?? null,
    analysisMd: row?.analysis_md ?? "",
    promptTemplateName: row?.prompt_template_name ?? "",
    categories: effective.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      description: domain.description,
      sourcePathCount: domain.sourcePaths.length,
      testPathCount: domain.testPaths.length,
    })),
    newDomainProposals: overlay?.newDomainProposals ?? [],
  };
}

export async function getEffectiveClassificationTaxonomy(
  env: WorkerEnv,
  userId: string,
  repoId: string,
) {
  const taxonomy = getRepositoryTaxonomy(repoId);
  const row = await findClassificationTaxonomyOverride(env, userId, taxonomy.repoId);
  return applyTaxonomyOverlay(taxonomy, parseJson<TaxonomyOverlay | null>(row?.overlay_json, null));
}

export async function listClassificationTaxonomyStates(env: WorkerEnv, userId: string) {
  return Promise.all(["vllm", "vllm-ascend"].map(async (repoId) => {
    const taxonomy = getRepositoryTaxonomy(repoId);
    return mapState(taxonomy, await findClassificationTaxonomyOverride(env, userId, repoId));
  }));
}

export async function refreshClassificationTaxonomy(
  env: WorkerEnv,
  userId: string,
  rawRepoId: string,
) {
  const repoId = normalizeRepositoryTaxonomyId(rawRepoId);
  if (rawRepoId !== repoId) throw new HttpError(404, "分类仓库不存在");
  const taxonomy = await getEffectiveClassificationTaxonomy(env, userId, repoId);
  const task = await resolveAITask(
    env,
    userId,
    aiTaskKeyForFeature(promptFeature(repoId), repoId),
  );
  const prompt = task.prompt;
  const now = new Date().toISOString();
  if (task.executionMode !== "api") {
    const activeJob = await findActiveLocalAnalysisJob(env, {
      userId,
      jobType: "managed_ai_task",
      subjectKind: "taxonomy",
      repoScope: repoId,
    });
    if (activeJob) return { job: mapLocalJob(activeJob), taxonomy: null };
  }
  await markClassificationTaxonomyRunning(env, { userId, repoId, baseVersion: taxonomy.version, now });
  try {
    const samples = await listClassificationTaxonomySamples(env, repoId, 80);
    const evidence = samples.map((row) => ({
      kind: row.kind, number: row.number, title: row.title,
      labels: parseJson(row.labels_json, []),
      files: parseJson<Record<string, any>>(row.diff_json, {}).entries ?? [],
      currentDomain: row.domain, confidence: row.domain_confidence,
    }));
    if (task.executionMode !== "api") {
      const job = await enqueueManagedAITask(env, {
        userId,
        taskKey: task.key,
        purpose: "taxonomy_refresh",
        subjectKind: "taxonomy",
        subjectKey: `${repoId}:${now}`,
        repoScope: repoId,
        request: {
          workspaceMode: "none",
          updatePolicy: "none",
          permissionProfileId: "safe_readonly",
          evidenceOnly: true,
          repoId,
          baseVersion: getRepositoryTaxonomy(repoId).version,
          taxonomy: taxonomy.domains.map((domain) => ({
            id: domain.id,
            name: domain.name,
            description: domain.description,
            sourcePaths: domain.sourcePaths,
            testPaths: domain.testPaths,
            codeownerPaths: domain.codeownerPaths,
          })),
          classificationPrompt: buildClassificationSystemPrompt(taxonomy),
          samples: evidence,
        },
      });
      return { job, taxonomy: null };
    }
    const result = await executeResolvedAITask(env, {
      userId,
      task,
      messages: [
        { role: "system", content: prompt.systemContract },
        { role: "user", content: `当前启用要求（${prompt.name} · r${prompt.revision}）：\n${prompt.instruction}\n\n当前分类规则：\n${buildClassificationSystemPrompt(taxonomy)}\n\n近期数据库样本：\n${JSON.stringify(evidence).slice(0, 70_000)}` },
      ],
      fallback: "{}",
    });
    if (result.provider !== "api") throw new HttpError(503, "未配置可用 AI Provider，无法刷新分类标准");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(stripFence(result.content));
    } catch {
      throw new HttpError(502, "分类标准刷新未返回有效 JSON");
    }
    const overlay = validateTaxonomyOverlay(payload, taxonomy);
    const analysisMd = typeof payload.analysisMarkdown === "string"
      ? payload.analysisMarkdown.slice(0, 60_000)
      : "# 分类标准刷新分析\n\n已根据近期样本生成并应用受限增量规则。";
    await saveClassificationTaxonomyOverride(env, {
      userId, repoId, baseVersion: getRepositoryTaxonomy(repoId).version,
      overlayVersion: overlay.version, overlayJson: JSON.stringify(overlay), analysisMd,
      promptTemplateId: prompt.templateId, promptTemplateName: prompt.name,
      promptRevision: prompt.revision, promptVersion: prompt.promptVersion,
      provider: result.providerName, model: result.model, now,
    });
    const row = await findClassificationTaxonomyOverride(env, userId, repoId);
    return { job: null, taxonomy: mapState(getRepositoryTaxonomy(repoId), row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "分类标准刷新失败";
    await failClassificationTaxonomyRefresh(env, { userId, repoId, error: message, now: new Date().toISOString() });
    throw error;
  }
}
