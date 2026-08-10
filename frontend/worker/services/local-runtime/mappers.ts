import { parseJson } from "../../mappers/database-row";

export function rowAgentSessionId(row: Record<string, any> | null | undefined) {
  return row?.agent_session_id ?? null;
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
    engineId: row.engine_id || "",
    agentSessionId: rowAgentSessionId(row),
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
