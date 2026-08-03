import { first, query, run, type WorkerEnv } from "../db";

export function listDomainActivityRows(env: WorkerEnv, cutoff: string) {
  return query<Record<string, any>>(
    env,
    `SELECT repo_id, domain,
      SUM(CASE WHEN kind = 'pr' THEN 1 ELSE 0 END) AS pulls,
      SUM(CASE WHEN kind = 'issue' THEN 1 ELSE 0 END) AS issues,
      SUM(CASE WHEN important = 1 THEN 1 ELSE 0 END) AS risks,
      MAX(updated_at) AS latest_change
     FROM community_items
     WHERE updated_at >= ?
     GROUP BY repo_id, domain`,
    [cutoff],
  );
}

export function listDomainEventRows(
  env: WorkerEnv,
  start: string,
  end: string,
) {
  return query<Record<string, any>>(
    env,
    `SELECT e.id AS event_id, e.event_type, e.occurred_at,
      ci.id AS item_id, ci.repo_id, ci.kind, ci.number, ci.title,
      ci.domain, ci.updated_at, ci.diff_json
     FROM community_events e
     JOIN community_items ci ON ci.id = e.item_id
     WHERE e.occurred_at >= ? AND e.occurred_at < ?
     ORDER BY e.occurred_at DESC
     LIMIT 400`,
    [start, end],
  );
}

export function listDomainSnapshotRows(env: WorkerEnv) {
  return query<Record<string, any>>(
    env,
    "SELECT * FROM domain_snapshots ORDER BY snapshot_date DESC, created_at DESC",
  );
}

export async function saveDomainSnapshot(
  env: WorkerEnv,
  input: {
    id: string;
    domain: string;
    date: string;
    architectureMd: string;
    changedPaths: string[];
    activity: unknown;
    insightMd: string;
    promptTemplateId: string;
    promptTemplateName: string;
    promptRevision: number;
    promptVersion: string;
    model: string;
    provider: string;
    generationSource: string;
    createdAt: string;
  },
) {
  await run(
    env,
    `INSERT INTO domain_snapshots (
      id, domain, snapshot_date, architecture_md, changed_paths_json,
      activity_json, insight_md, prompt_template_id, prompt_template_name,
      prompt_revision, prompt_version, model, provider, generation_source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain, snapshot_date) DO UPDATE SET
      architecture_md = excluded.architecture_md,
      changed_paths_json = excluded.changed_paths_json,
      activity_json = excluded.activity_json,
      insight_md = excluded.insight_md,
      prompt_template_id = excluded.prompt_template_id,
      prompt_template_name = excluded.prompt_template_name,
      prompt_revision = excluded.prompt_revision,
      prompt_version = excluded.prompt_version,
      model = excluded.model,
      provider = excluded.provider,
      generation_source = excluded.generation_source,
      created_at = excluded.created_at`,
    [
      input.id,
      input.domain,
      input.date,
      input.architectureMd,
      JSON.stringify(input.changedPaths),
      JSON.stringify(input.activity),
      input.insightMd,
      input.promptTemplateId,
      input.promptTemplateName,
      input.promptRevision,
      input.promptVersion,
      input.model,
      input.provider,
      input.generationSource,
      input.createdAt,
    ],
  );
  return first<Record<string, any>>(
    env,
    "SELECT * FROM domain_snapshots WHERE id = ?",
    [input.id],
  );
}
