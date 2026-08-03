import { first, query, run, type WorkerEnv } from "../db";
import type { LocalJobType } from "../domain/local-analysis";

export async function ensureLocalRunnerSettings(env: WorkerEnv, userId: string) {
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO local_runner_settings(
      user_id, enabled, default_provider, default_model, max_concurrency,
      worktree_retention_hours, auto_fetch, timeout_seconds, created_at, updated_at
    ) VALUES(?, 0, '', '', 1, 24, 1, 900, ?, ?)
    ON CONFLICT(user_id) DO NOTHING`,
    [userId, now, now],
  );
  return first<Record<string, any>>(
    env,
    "SELECT * FROM local_runner_settings WHERE user_id = ?",
    [userId],
  );
}

export async function updateLocalRunnerSettings(
  env: WorkerEnv,
  input: {
    userId: string;
    enabled: boolean;
    defaultProvider: string;
    defaultModel: string;
    maxConcurrency: number;
    worktreeRetentionHours: number;
    autoFetch: boolean;
    timeoutSeconds: number;
  },
) {
  await ensureLocalRunnerSettings(env, input.userId);
  await run(
    env,
    `UPDATE local_runner_settings SET enabled = ?, default_provider = ?,
      default_model = ?, max_concurrency = ?, worktree_retention_hours = ?,
      auto_fetch = ?, timeout_seconds = ?, updated_at = ? WHERE user_id = ?`,
    [
      input.enabled ? 1 : 0,
      input.defaultProvider,
      input.defaultModel,
      input.maxConcurrency,
      input.worktreeRetentionHours,
      input.autoFetch ? 1 : 0,
      input.timeoutSeconds,
      new Date().toISOString(),
      input.userId,
    ],
  );
  return ensureLocalRunnerSettings(env, input.userId);
}

export function latestLocalRunner(env: WorkerEnv) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM local_runners ORDER BY last_seen_at DESC LIMIT 1",
  );
}

export function effectiveLocalRunnerPolicy(env: WorkerEnv) {
  return first<Record<string, any>>(
    env,
    `SELECT MAX(max_concurrency) AS max_concurrency,
      MIN(worktree_retention_hours) AS worktree_retention_hours
     FROM local_runner_settings WHERE enabled = 1`,
  );
}

export async function upsertLocalRunnerHeartbeat(
  env: WorkerEnv,
  input: {
    id: string;
    userId: string;
    status: string;
    version: string;
    opencodeVersion: string;
    authConfigured: boolean;
    readonlyVerified: boolean;
    repositories: unknown;
    providers: unknown;
    capabilities: unknown;
    activeJobs: number;
    lastError: string | null;
  },
) {
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO local_runners(
      id, user_id, status, version, opencode_version, auth_configured,
      readonly_verified, repositories_json, providers_json, capabilities_json,
      active_jobs, last_seen_at, last_error, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id, status = excluded.status,
      version = excluded.version, opencode_version = excluded.opencode_version,
      auth_configured = excluded.auth_configured,
      readonly_verified = excluded.readonly_verified,
      repositories_json = excluded.repositories_json,
      providers_json = excluded.providers_json,
      capabilities_json = excluded.capabilities_json,
      active_jobs = excluded.active_jobs, last_seen_at = excluded.last_seen_at,
      last_error = excluded.last_error, updated_at = excluded.updated_at`,
    [
      input.id,
      input.userId,
      input.status,
      input.version,
      input.opencodeVersion,
      input.authConfigured ? 1 : 0,
      input.readonlyVerified ? 1 : 0,
      JSON.stringify(input.repositories),
      JSON.stringify(input.providers),
      JSON.stringify(input.capabilities),
      input.activeJobs,
      now,
      input.lastError,
      now,
      now,
    ],
  );
  return latestLocalRunner(env);
}

export async function enqueueLocalAnalysisJob(
  env: WorkerEnv,
  input: {
    id: string;
    userId: string;
    jobType: LocalJobType;
    subjectKind?: string;
    subjectKey?: string;
    repoScope?: string;
    itemId?: string | null;
    chatThreadId?: string | null;
    sessionScope: string;
    baseSha?: string | null;
    headSha?: string | null;
    targetRef?: string;
    providerId?: string;
    modelId?: string;
    opencodeSessionId?: string | null;
    priority?: number;
    request: unknown;
    createdAt?: string;
  },
) {
  const now = input.createdAt || new Date().toISOString();
  await run(
    env,
    `INSERT INTO local_analysis_jobs(
      id, user_id, job_type, subject_kind, subject_key, repo_scope,
      item_id, chat_thread_id, session_scope, base_sha, head_sha, target_ref,
      provider_id, model_id, opencode_session_id, status, priority,
      request_json, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    [
      input.id,
      input.userId,
      input.jobType,
      input.subjectKind || "",
      input.subjectKey || "",
      input.repoScope || "",
      input.itemId ?? null,
      input.chatThreadId ?? null,
      input.sessionScope,
      input.baseSha ?? null,
      input.headSha ?? null,
      input.targetRef || "",
      input.providerId || "",
      input.modelId || "",
      input.opencodeSessionId ?? null,
      input.priority ?? 50,
      JSON.stringify(input.request),
      now,
      now,
    ],
  );
  return findLocalAnalysisJob(env, input.id);
}

export function findLocalAnalysisJob(env: WorkerEnv, jobId: string) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM local_analysis_jobs WHERE id = ?",
    [jobId],
  );
}

export function findUserLocalAnalysisJob(
  env: WorkerEnv,
  userId: string,
  jobId: string,
) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM local_analysis_jobs WHERE id = ? AND user_id = ?",
    [jobId, userId],
  );
}

export function listUserLocalAnalysisJobs(
  env: WorkerEnv,
  userId: string,
  limit = 50,
) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM local_analysis_jobs WHERE user_id = ?
     ORDER BY updated_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function claimNextLocalAnalysisJob(
  env: WorkerEnv,
  runnerId: string,
) {
  const now = new Date().toISOString();
  const rows = await query<Record<string, any>>(
    env,
    `UPDATE local_analysis_jobs SET status = 'claimed', runner_id = ?,
      claimed_at = ?, updated_at = ?, attempt_count = attempt_count + 1
     WHERE id = (
       SELECT id FROM local_analysis_jobs WHERE status = 'queued'
       ORDER BY priority DESC, created_at ASC LIMIT 1
     ) AND status = 'queued'
     RETURNING *`,
    [runnerId, now, now],
  );
  return rows[0] ?? null;
}

export function markLocalAnalysisJobRunning(
  env: WorkerEnv,
  jobId: string,
  runnerId: string,
) {
  const now = new Date().toISOString();
  return run(
    env,
    `UPDATE local_analysis_jobs SET status = 'running', started_at = ?,
      updated_at = ? WHERE id = ? AND runner_id = ? AND status = 'claimed'`,
    [now, now, jobId, runnerId],
  );
}

export function requestLocalAnalysisCancellation(
  env: WorkerEnv,
  userId: string,
  jobId: string,
) {
  return run(
    env,
    `UPDATE local_analysis_jobs SET status = 'cancel_requested', updated_at = ?
     WHERE id = ? AND user_id = ? AND status IN ('queued', 'claimed', 'running')`,
    [new Date().toISOString(), jobId, userId],
  );
}

export function listLocalAnalysisEvents(
  env: WorkerEnv,
  jobId: string,
  afterSequence = 0,
) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM local_analysis_events WHERE job_id = ? AND sequence > ?
     ORDER BY sequence ASC LIMIT 500`,
    [jobId, afterSequence],
  );
}

export async function appendLocalAnalysisEvents(
  env: WorkerEnv,
  jobId: string,
  events: Array<{
    sequence: number;
    eventType: string;
    source: string;
    level: string;
    message: string;
    metadata: unknown;
    createdAt: string;
  }>,
) {
  for (const event of events.slice(0, 200)) {
    await run(
      env,
      `INSERT INTO local_analysis_events(
        job_id, sequence, event_type, source, level, message,
        metadata_json, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id, sequence) DO NOTHING`,
      [
        jobId,
        event.sequence,
        event.eventType,
        event.source,
        event.level,
        event.message,
        JSON.stringify(event.metadata),
        event.createdAt,
      ],
    );
  }
}

export function completeLocalAnalysisJobRow(
  env: WorkerEnv,
  input: {
    jobId: string;
    runnerId: string;
    status: "completed" | "failed" | "cancelled";
    result: unknown;
    error: string | null;
    opencodeSessionId?: string | null;
    localEvidence: boolean;
    analysisDocumentId?: string | null;
  },
) {
  const now = new Date().toISOString();
  return run(
    env,
    `UPDATE local_analysis_jobs SET status = ?, result_json = ?, error = ?,
      opencode_session_id = COALESCE(?, opencode_session_id),
      local_evidence = ?, analysis_document_id = COALESCE(?, analysis_document_id),
      request_json = '{}', finished_at = ?, updated_at = ?
     WHERE id = ? AND runner_id = ?
       AND status IN ('claimed', 'running', 'cancel_requested')`,
    [
      input.status,
      JSON.stringify(input.result),
      input.error,
      input.opencodeSessionId ?? null,
      input.localEvidence ? 1 : 0,
      input.analysisDocumentId ?? null,
      now,
      now,
      input.jobId,
      input.runnerId,
    ],
  );
}

export function findSessionBinding(
  env: WorkerEnv,
  userId: string,
  sessionScope: string,
  commitSha: string,
) {
  return first<Record<string, any>>(
    env,
    `SELECT * FROM opencode_session_bindings
     WHERE user_id = ? AND session_scope = ? AND commit_sha = ?`,
    [userId, sessionScope, commitSha],
  );
}

export function latestSessionBinding(
  env: WorkerEnv,
  userId: string,
  sessionScope: string,
) {
  return first<Record<string, any>>(
    env,
    `SELECT * FROM opencode_session_bindings
     WHERE user_id = ? AND session_scope = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [userId, sessionScope],
  );
}

export function upsertSessionBinding(
  env: WorkerEnv,
  input: {
    id: string;
    userId: string;
    sessionScope: string;
    repoScope: string;
    commitSha: string;
    opencodeSessionId: string;
    runnerId: string;
    providerId: string;
    modelId: string;
    summaryMd: string;
    confirmedFacts: unknown;
    unresolved: unknown;
    focus: unknown;
  },
) {
  const now = new Date().toISOString();
  return run(
    env,
    `INSERT INTO opencode_session_bindings(
      id, user_id, session_scope, repo_scope, commit_sha, opencode_session_id,
      runner_id, provider_id, model_id, summary_md, confirmed_facts_json,
      unresolved_json, focus_json, worktree_state, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rebuildable', ?, ?)
    ON CONFLICT(user_id, session_scope, commit_sha) DO UPDATE SET
      opencode_session_id = excluded.opencode_session_id,
      runner_id = excluded.runner_id, provider_id = excluded.provider_id,
      model_id = excluded.model_id, summary_md = excluded.summary_md,
      confirmed_facts_json = excluded.confirmed_facts_json,
      unresolved_json = excluded.unresolved_json, focus_json = excluded.focus_json,
      updated_at = excluded.updated_at`,
    [
      input.id,
      input.userId,
      input.sessionScope,
      input.repoScope,
      input.commitSha,
      input.opencodeSessionId,
      input.runnerId,
      input.providerId,
      input.modelId,
      input.summaryMd,
      JSON.stringify(input.confirmedFacts),
      JSON.stringify(input.unresolved),
      JSON.stringify(input.focus),
      now,
      now,
    ],
  );
}

export function updateThreadLocalAnalysisState(
  env: WorkerEnv,
  input: {
    threadId: string;
    mode: "normal" | "repository";
    repoScope: string;
    targetRef: string;
    providerId: string;
    modelId: string;
    sessionId?: string | null;
    commitSha?: string;
    runnerJobId?: string | null;
    localEvidence?: boolean;
  },
) {
  return run(
    env,
    `UPDATE chat_threads SET mode = ?, repo_scope = ?, target_ref = ?,
      provider_id = ?, model_id = ?,
      opencode_session_id = COALESCE(?, opencode_session_id),
      opencode_commit_sha = COALESCE(?, opencode_commit_sha),
      runner_job_id = ?, local_evidence = ?, updated_at = ? WHERE id = ?`,
    [
      input.mode,
      input.repoScope,
      input.targetRef,
      input.providerId,
      input.modelId,
      input.sessionId ?? null,
      input.commitSha ?? null,
      input.runnerJobId ?? null,
      input.localEvidence ? 1 : 0,
      new Date().toISOString(),
      input.threadId,
    ],
  );
}

export async function createLocalAnalysisDocumentRow(
  env: WorkerEnv,
  input: {
    id: string;
    type: string;
    scope: string;
    title: string;
    summaryMd: string;
    contentMd: string;
    prompt: string;
    promptTemplateId: string | null;
    promptTemplateName: string;
    promptRevision: number;
    model: string;
    baseSha: string | null;
    headSha: string | null;
    bodyHash: string;
    filesHash: string;
    promptType: string;
    promptVersion: string;
    provider: string;
    versionStatus: "current" | "outdated";
    userId: string;
    codeReferences: unknown;
    evidenceCompleteness: "complete" | "partial" | "insufficient";
    opencodeSessionId: string | null;
    runnerJobId: string;
    localEvidence: boolean;
    createdAt: string;
  },
) {
  await run(
    env,
    `INSERT INTO analysis_documents(
      id, type, scope, title, summary_md, content_md, prompt,
      prompt_template_id, prompt_template_name, prompt_revision, model, status,
      base_sha, head_sha, body_hash, files_hash, prompt_type, prompt_version,
      runner, provider, version_status, created_by, source_refs_json,
      analysis_source, evidence_completeness, opencode_session_id, runner_job_id,
      code_references_json, local_evidence, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?,
      'opencode', ?, ?, ?, ?, 'ai', ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.type,
      input.scope,
      input.title,
      input.summaryMd,
      input.contentMd,
      input.prompt,
      input.promptTemplateId,
      input.promptTemplateName,
      input.promptRevision,
      input.model,
      input.baseSha,
      input.headSha,
      input.bodyHash,
      input.filesHash,
      input.promptType,
      input.promptVersion,
      input.provider,
      input.versionStatus,
      input.userId,
      JSON.stringify(input.codeReferences),
      input.evidenceCompleteness,
      input.opencodeSessionId,
      input.runnerJobId,
      JSON.stringify(input.codeReferences),
      input.localEvidence ? 1 : 0,
      input.createdAt,
      input.createdAt,
    ],
  );
}
