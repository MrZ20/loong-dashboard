import {
  first,
  query,
  run,
  type WorkerEnv,
} from "../db";

export function listDailyAnalysisRows(
  env: WorkerEnv,
  scope: string,
  start: string,
  end: string,
) {
  return query<Record<string, any>>(
    env,
    `SELECT
      community_items.repo_id,
      community_items.kind,
      community_items.number,
      community_items.title,
      community_items.domain,
      community_items.ai_summary,
      community_items.summary_source,
      community_items.updated_at,
      community_events.event_type,
      community_events.occurred_at
     FROM community_events
     JOIN community_items ON community_items.id = community_events.item_id
     WHERE (? = 'all' OR community_items.repo_id = ?)
       AND community_events.occurred_at >= ?
       AND community_events.occurred_at < ?
     ORDER BY community_events.occurred_at DESC
     LIMIT 120`,
    [scope, scope, start, end],
  );
}

export function listRecentAnalysisRows(env: WorkerEnv, scope: string) {
  return query<Record<string, any>>(
    env,
    `SELECT repo_id, kind, number, title, domain, ai_summary,
      summary_source, updated_at
     FROM community_items
     WHERE (? = 'all' OR repo_id = ?)
     ORDER BY updated_at DESC LIMIT 80`,
    [scope, scope],
  );
}

export function listAnalysisWatchRows(env: WorkerEnv, userId: string) {
  return query<Record<string, any>>(
    env,
    `SELECT community_items.repo_id, community_items.kind,
      community_items.number, community_items.title,
      watchlist.reason, watchlist.priority, watchlist.note
     FROM watchlist
     JOIN community_items ON community_items.id = watchlist.item_id
     WHERE watchlist.user_id = ?
     ORDER BY
       CASE watchlist.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1
         WHEN 'P2' THEN 2 ELSE 3 END,
       watchlist.created_at DESC
     LIMIT 30`,
    [userId],
  );
}

export function listAnalysisImpactRows(env: WorkerEnv) {
  return query<Record<string, any>>(
    env,
    `SELECT source.repo_id, source.kind, source.number, source.title,
      cross_repo_impacts.domain, cross_repo_impacts.level,
      cross_repo_impacts.status, cross_repo_impacts.analysis
     FROM cross_repo_impacts
     JOIN community_items source
       ON source.id = cross_repo_impacts.source_item_id
     ORDER BY cross_repo_impacts.updated_at DESC
     LIMIT 30`,
  );
}

export async function createGeneratedAnalysisRow(
  env: WorkerEnv,
  input: {
    id: string;
    type: string;
    scope: string;
    title: string;
    summaryMd: string;
    contentMd: string;
    prompt: string;
    promptTemplateId: string;
    promptTemplateName: string;
    promptRevision: number;
    model: string;
    userId: string;
    sourceRefs: string[];
    createdAt: string;
  },
) {
  await run(
    env,
    `INSERT INTO analysis_documents (
      id, type, scope, title, summary_md, content_md, prompt,
      prompt_template_id, prompt_template_name, prompt_revision, model, status,
      created_by, source_refs_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
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
      input.userId,
      JSON.stringify(input.sourceRefs),
      input.createdAt,
      input.createdAt,
    ],
  );
  return first<Record<string, any>>(
    env,
    "SELECT * FROM analysis_documents WHERE id = ?",
    [input.id],
  );
}
