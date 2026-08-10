import { query, run, type WorkerEnv } from "../db";

export function listSummaryCandidates(
  env: WorkerEnv,
  input: {
    repoId: string;
    itemId?: string | null;
    cutoff: string;
    maxItems: number;
    prPromptVersion: string;
    prTemplateId: string;
    prRevision: number;
    issuePromptVersion: string;
    issueTemplateId: string;
    issueRevision: number;
    stateFilter: string;
    domainFilter: string;
  },
) {
  return query<Record<string, any>>(
    env,
    `SELECT community_items.*, repositories.owner, repositories.name
     FROM community_items
     JOIN repositories ON repositories.id = community_items.repo_id
     WHERE community_items.repo_id = ?
       AND (? IS NULL OR community_items.id = ?)
       AND (? IS NOT NULL OR community_items.updated_at >= ?)
       AND (? IS NOT NULL OR ? = 'all' OR community_items.state = ?)
       AND (? IS NOT NULL OR ? = 'all' OR community_items.domain = ?)
       AND (
         community_items.summary_status IN ('missing', 'stale', 'failed')
         OR (community_items.kind = 'pr' AND (
           COALESCE(community_items.summary_prompt_version, '') != ?
           OR COALESCE(community_items.summary_prompt_template_id, '') != ?
           OR COALESCE(community_items.summary_prompt_revision, 0) != ?
         ))
         OR (community_items.kind = 'issue' AND (
           COALESCE(community_items.summary_prompt_version, '') != ?
           OR COALESCE(community_items.summary_prompt_template_id, '') != ?
           OR COALESCE(community_items.summary_prompt_revision, 0) != ?
         ))
         OR ? IS NOT NULL
       )
     ORDER BY community_items.updated_at DESC LIMIT ?`,
    [
      input.repoId,
      input.itemId ?? null,
      input.itemId ?? null,
      input.itemId ?? null,
      input.cutoff,
      input.itemId ?? null,
      input.stateFilter,
      input.stateFilter,
      input.itemId ?? null,
      input.domainFilter,
      input.domainFilter,
      input.prPromptVersion,
      input.prTemplateId,
      input.prRevision,
      input.issuePromptVersion,
      input.issueTemplateId,
      input.issueRevision,
      input.itemId ?? null,
      input.itemId ? 1 : input.maxItems,
    ],
  );
}

export function requeueSummaryJob(
  env: WorkerEnv,
  jobId: string,
  priority: string,
) {
  return run(
    env,
    `UPDATE community_summary_jobs SET status = 'queued', error = NULL,
      priority = ?, created_at = ? WHERE id = ?`,
    [priority, new Date().toISOString(), jobId],
  );
}

export function markSummaryRunning(env: WorkerEnv, itemId: string) {
  return run(
    env,
    "UPDATE community_items SET summary_status = 'running', summary_error = NULL WHERE id = ?",
    [itemId],
  );
}

export function saveSummaryResult(
  env: WorkerEnv,
  input: {
    itemId: string;
    summary: string;
    headSha: string | null;
    bodyHash: string;
    filesHash: string;
    promptVersion: string;
    promptType: string;
    model: string;
    provider: string;
    structured: unknown;
    evidenceCompleteness: string;
    templateId: string;
    revision: number;
    generatedAt: string;
    evidence: string[];
  },
) {
  return run(
    env,
    `UPDATE community_items SET
      ai_summary = ?, summary_source = 'ai',
      summary_status = 'ready', summary_head_sha = ?, summary_body_hash = ?,
      summary_files_hash = ?, summary_prompt_version = ?,
      summary_prompt_type = ?, summary_model = ?, summary_provider = ?,
      summary_structured_json = ?, summary_evidence_completeness = ?,
      summary_prompt_template_id = ?, summary_prompt_revision = ?,
      summary_generated_at = ?, summary_updated_at = ?,
      summary_evidence_json = ?, summary_error = NULL
     WHERE id = ? AND body_hash = ? AND files_hash = ?
       AND COALESCE(head_sha, '') = COALESCE(?, '')`,
    [
      input.summary,
      input.headSha,
      input.bodyHash,
      input.filesHash,
      input.promptVersion,
      input.promptType,
      input.model,
      input.provider,
      JSON.stringify(input.structured),
      input.evidenceCompleteness,
      input.templateId,
      input.revision,
      input.generatedAt,
      input.generatedAt,
      JSON.stringify(input.evidence),
      input.itemId,
      input.bodyHash,
      input.filesHash,
      input.headSha,
    ],
  );
}

export function markSummaryFailed(
  env: WorkerEnv,
  input: {
    itemId: string;
    message: string;
    bodyHash: string;
    filesHash: string;
    headSha: string | null;
  },
) {
  return run(
    env,
    `UPDATE community_items SET summary_status = 'failed', summary_error = ?
     WHERE id = ? AND body_hash = ? AND files_hash = ?
       AND COALESCE(head_sha, '') = COALESCE(?, '')`,
    [input.message, input.itemId, input.bodyHash, input.filesHash, input.headSha],
  );
}
