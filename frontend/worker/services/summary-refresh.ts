import { summarizeCommunityItem } from "../ai";
import type { WorkerEnv } from "../db";
import {
  buildIssueAnalysisInput,
  buildPrAnalysisInput,
  effectivePromptVersion,
} from "../domain/analysis-quality";
import {
  shouldSkipSummaryJob,
  summaryVersionKey,
} from "../domain/refresh-policy";
import { HttpError } from "../http";
import { aiTaskKeyForFeature } from "../domain/ai-task-catalog";
import {
  createSummaryJob,
  findSummaryJob,
  updateSummaryJobStatus,
} from "../repositories/refresh-tasks";
import {
  listSummaryCandidates,
  markSummaryFailed,
  markSummaryRunning,
  requeueSummaryJob,
  saveSummaryResult,
} from "../repositories/summaries";
import { resolveAITask } from "./ai-task-settings";
import { enqueueManagedAITask } from "./local-analysis";
import { ensurePullPatches } from "./pull-details";
import { withUserGithubToken } from "./github-settings";

export async function refreshCommunitySummaries(
  env: WorkerEnv,
  input: {
    userId: string;
    repoId: string;
    activeRangeHours: number;
    maxItems: number;
    itemId?: string | null;
    priority: "normal" | "high";
  },
) {
  const [prTask, issueTask] = await Promise.all([
    resolveAITask(env, input.userId, aiTaskKeyForFeature("pr_triage", input.repoId)),
    resolveAITask(env, input.userId, aiTaskKeyForFeature("issue_triage", input.repoId)),
  ]);
  const prPrompt = prTask.prompt;
  const issuePrompt = issueTask.prompt;
  const cutoff = new Date(
    Date.now() - input.activeRangeHours * 3_600_000,
  ).toISOString();
  const rows = await listSummaryCandidates(env, {
    repoId: input.repoId,
    itemId: input.itemId,
    cutoff,
    maxItems: input.maxItems,
    prPromptVersion: prPrompt.promptVersion,
    prTemplateId: prPrompt.templateId,
    prRevision: prPrompt.revision,
    issuePromptVersion: issuePrompt.promptVersion,
    issueTemplateId: issuePrompt.templateId,
    issueRevision: issuePrompt.revision,
  });
  const githubEnv = await withUserGithubToken(env, input.userId);
  let analyzed = 0;
  let skipped = 0;
  for (const row of rows) {
    const kind = row.kind === "pr" ? "pr" : "issue";
    const task = kind === "pr" ? prTask : issueTask;
    const prompt = kind === "pr" ? prPrompt : issuePrompt;
    const jobPromptVersion = effectivePromptVersion(prompt);
    const versionKey = summaryVersionKey({
      kind,
      headSha: row.head_sha,
      bodyHash: row.body_hash,
      filesHash: row.files_hash,
    });
    let job = await findSummaryJob(
      env,
      input.userId,
      row.id,
      versionKey,
      jobPromptVersion,
    );
    if (shouldSkipSummaryJob(job?.status)) {
      skipped += 1;
      continue;
    }
    if (!job) {
      job = await createSummaryJob(env, {
        userId: input.userId,
        itemId: row.id,
        versionKey,
        promptVersion: jobPromptVersion,
        priority: input.priority,
      });
    } else {
      await requeueSummaryJob(env, job.id, input.priority);
    }
    if (!job) continue;
    await updateSummaryJobStatus(env, job.id, "running");
    await markSummaryRunning(env, row.id);
    try {
      const diff = row.kind === "pr" && row.diff_json
        ? JSON.parse(row.diff_json)
        : null;
      let finalContext:
        | ReturnType<typeof buildPrAnalysisInput>
        | ReturnType<typeof buildIssueAnalysisInput>;
      if (kind === "issue") {
        finalContext = buildIssueAnalysisInput({
            repository: `${row.owner}/${row.name}`,
            number: Number(row.number),
            title: row.title,
            bodyMd: row.body_md || "",
            labels: row.labels_json ? JSON.parse(row.labels_json) : [],
            author: row.author || "",
            comments: Number(row.comments ?? 0),
            state: row.state,
            updatedAt: row.updated_at,
          });
      } else {
        if (task.executionMode === "opencode") {
          finalContext = buildPrAnalysisInput({
            repository: `${row.owner}/${row.name}`,
            number: Number(row.number),
            title: row.title,
            bodyMd: row.body_md || "",
            baseSha: row.base_sha ?? null,
            headSha: row.head_sha ?? null,
            state: row.state,
            diff,
            patches: [],
            skipped: [],
            missingPatchPaths: Array.isArray(diff?.entries)
              ? diff.entries.map((entry: Record<string, unknown>) => String(entry.path || "")).filter(Boolean)
              : [],
            reviewSignal: row.review_signal_json
              ? JSON.parse(row.review_signal_json)
              : null,
          });
          await enqueueManagedAITask(env, {
            userId: input.userId,
            taskKey: task.key,
            purpose: "community_summary",
            subjectKind: kind,
            subjectKey: `${row.repo_id}:${kind}:${row.number}`,
            repoScope: row.repo_id,
            targetRef: row.head_sha || "HEAD",
            baseSha: row.base_sha ?? null,
            headSha: row.head_sha ?? null,
            itemId: row.id,
            priority: input.priority === "high" ? 95 : 55,
            request: {
              summaryJobId: job.id,
              analysisContext: finalContext,
              version: {
                headSha: row.head_sha ?? null,
                bodyHash: row.body_hash,
                filesHash: row.files_hash,
              },
            },
          });
          analyzed += 1;
          continue;
        }
        const patches = await ensurePullPatches(githubEnv, row.repo_id, Number(row.number));
        finalContext = buildPrAnalysisInput({
          repository: `${row.owner}/${row.name}`,
          number: Number(row.number),
          title: row.title,
          bodyMd: row.body_md || "",
          baseSha: row.base_sha ?? null,
          headSha: row.head_sha ?? null,
          state: row.state,
          diff,
          patches: patches.entries,
          skipped: patches.skipped,
          missingPatchPaths: patches.missingPatchPaths,
          reviewSignal: row.review_signal_json
            ? JSON.parse(row.review_signal_json)
            : null,
        });
      }
      if (kind === "issue" && task.executionMode === "opencode") {
        await enqueueManagedAITask(env, {
          userId: input.userId,
          taskKey: task.key,
          purpose: "community_summary",
          subjectKind: kind,
          subjectKey: `${row.repo_id}:${kind}:${row.number}`,
          repoScope: row.repo_id,
          targetRef: "HEAD",
          itemId: row.id,
          priority: input.priority === "high" ? 95 : 55,
          request: {
            summaryJobId: job.id,
            analysisContext: finalContext,
            version: {
              headSha: null,
              bodyHash: row.body_hash,
              filesHash: row.files_hash,
            },
          },
        });
        analyzed += 1;
        continue;
      }
      const result = await summarizeCommunityItem(env, {
        userId: input.userId,
        repo: input.repoId,
        kind,
        context: finalContext,
      });
      const generatedAt = new Date().toISOString();
      const write = await saveSummaryResult(env, {
        itemId: row.id,
        summary: result.summary,
        headSha: row.head_sha ?? null,
        bodyHash: row.body_hash,
        filesHash: row.files_hash,
        promptVersion: result.prompt.promptVersion,
        promptType: finalContext.promptType,
        model: result.model,
        provider: result.providerName,
        structured: result.structured,
        evidenceCompleteness: result.evidenceCompleteness,
        templateId: result.prompt.templateId,
        revision: result.prompt.revision,
        generatedAt,
        evidence: finalContext.evidence,
      });
      if (Number((write as any)?.meta?.changes ?? 1) === 0) {
        throw new HttpError(409, "条目版本已变化，摘要结果未写入");
      }
      await updateSummaryJobStatus(env, job.id, "ready");
      analyzed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "摘要分析失败";
      await updateSummaryJobStatus(env, job.id, "failed", message.slice(0, 500));
      await markSummaryFailed(env, {
        itemId: row.id,
        message: message.slice(0, 500),
        bodyHash: row.body_hash,
        filesHash: row.files_hash,
        headSha: row.head_sha ?? null,
      });
      throw error;
    }
  }
  return { itemCount: analyzed, analyzed, skipped };
}
