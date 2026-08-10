import {
  architectureMatchesDomain,
  findArchitectureForDomain,
} from "./domain/architecture-catalog";
import {
  first,
  query,
  run,
  type WorkerEnv,
} from "./db";
import { parseJson } from "./mappers/database-row";
import { beijingDayWindow, formatBeijingTime } from "./time";

const EVENT_LABELS: Record<string, string> = {
  opened: "新建",
  updated: "更新",
  draft: "转为 Draft",
  ready_for_review: "转为 Ready",
  merged: "合入",
  closed: "关闭",
  reopened: "重新打开",
};

export function deduplicateObservedEvents(rows: Record<string, any>[]) {
  const deduplicatedRows: Record<string, any>[] = [];
  for (const row of rows) {
    const duplicateIndex = deduplicatedRows.findIndex(
      (candidate) =>
        candidate.item_id === row.item_id &&
        candidate.event_type === row.event_type &&
        Math.abs(
          new Date(candidate.occurred_at).valueOf() -
            new Date(row.occurred_at).valueOf(),
        ) <=
          2 * 60 * 1000,
    );
    if (duplicateIndex === -1) {
      deduplicatedRows.push(row);
      continue;
    }
    if (
      row.source === "github" &&
      deduplicatedRows[duplicateIndex].source !== "github"
    ) {
      deduplicatedRows[duplicateIndex] = row;
    }
  }
  return deduplicatedRows;
}

export async function getTodaySummary(env: WorkerEnv, repoId: string) {
  const window = beijingDayWindow();
  const rows = await query<Record<string, any>>(
    env,
    `SELECT
      community_events.id AS event_id,
      community_events.event_type,
      community_events.occurred_at,
      community_events.source,
      community_items.id AS item_id,
      community_items.kind,
      community_items.number,
      community_items.title,
      community_items.domain,
      community_items.important,
      community_items.state,
      community_items.html_url
     FROM community_events
     JOIN community_items ON community_items.id = community_events.item_id
     WHERE community_events.repo_id = ?
       AND community_events.occurred_at >= ?
       AND community_events.occurred_at < ?
     ORDER BY community_events.occurred_at DESC
     LIMIT 100`,
    [repoId, window.start, window.end],
  );
  const deduplicatedRows = deduplicateObservedEvents(rows);

  const counts = {
    opened: 0,
    updated: 0,
    draft: 0,
    readyForReview: 0,
    merged: 0,
    closed: 0,
    reopened: 0,
  };
  const fieldByEvent: Record<string, keyof typeof counts> = {
    opened: "opened",
    updated: "updated",
    draft: "draft",
    ready_for_review: "readyForReview",
    merged: "merged",
    closed: "closed",
    reopened: "reopened",
  };
  for (const row of deduplicatedRows) {
    const field = fieldByEvent[row.event_type];
    if (field) counts[field] += 1;
  }
  const domainCounts = new Map<string, number>();
  const countedDomainItems = new Set<string>();
  for (const row of deduplicatedRows) {
    if (
      row.domain &&
      row.domain !== "Other" &&
      !countedDomainItems.has(row.item_id)
    ) {
      countedDomainItems.add(row.item_id);
      domainCounts.set(row.domain, (domainCounts.get(row.domain) ?? 0) + 1);
    }
  }
  const topDomain =
    [...domainCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    "暂无明显热点";
  const importantIds = new Set(
    deduplicatedRows
      .filter((row) => Boolean(row.important))
      .map((row) => row.item_id),
  );
  const meaningfulItemIds = new Set(
    deduplicatedRows
      .filter((row) => row.event_type !== "updated")
      .map((row) => row.item_id),
  );
  const headline = deduplicatedRows.length
    ? `${topDomain} 是今日主要变化领域；${counts.opened} 项新建、${counts.merged} 项合入、${counts.closed} 项关闭、${counts.reopened} 项重新打开。`
    : "北京时间今天尚未采集到社区状态变化；可手动同步当前仓库。";

  return {
    ...window,
    repo: repoId,
    headline,
    topDomain,
    counts,
    importantChanges: meaningfulItemIds.size,
    riskCount: importantIds.size,
    events: deduplicatedRows.slice(0, 20).map((row) => ({
      id: row.event_id,
      type: row.event_type,
      label: EVENT_LABELS[row.event_type] ?? row.event_type,
      occurredAt: row.occurred_at,
      beijingTime: formatBeijingTime(row.occurred_at),
      source: row.source,
      item: {
        id: row.item_id,
        kind: row.kind,
        number: Number(row.number),
        title: row.title,
        domain: row.domain,
        important: Boolean(row.important),
        state: row.state,
        htmlUrl: row.html_url,
      },
    })),
  };
}

function changedPaths(row: Record<string, any>) {
  const diff = parseJson<Record<string, any> | null>(row.diff_json, null);
  return Array.isArray(diff?.entries)
    ? diff.entries
        .map((entry: Record<string, any>) => String(entry.path ?? ""))
        .filter(Boolean)
        .slice(0, 12)
    : [];
}

function titleTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  );
}

function similarity(left: string, right: string) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  let score = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) score += 1;
  }
  return score;
}

export async function refreshCrossRepoImpacts(env: WorkerEnv) {
  const sources = await query<Record<string, any>>(
    env,
    `SELECT * FROM community_items
     WHERE repo_id = 'vllm'
       AND domain != 'Other'
     ORDER BY important DESC, updated_at DESC
     LIMIT 20`,
  );
  const targets = await query<Record<string, any>>(
    env,
    `SELECT * FROM community_items
     WHERE repo_id = 'vllm-ascend'
     ORDER BY updated_at DESC
     LIMIT 100`,
  );
  const now = new Date().toISOString();
  for (const source of sources) {
    const architectureEntry = findArchitectureForDomain(source.repo_id, source.domain);
    if (!architectureEntry) continue;
    const { architecture } = architectureEntry;
    if (!architecture.ascendPaths.length) continue;
    const related = targets
      .filter((target) =>
        architectureMatchesDomain(architecture, target.repo_id, target.domain))
      .map((target) => ({
        target,
        score: similarity(source.title, target.title),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          new Date(right.target.updated_at).valueOf() -
            new Date(left.target.updated_at).valueOf(),
      )[0];
    const sourcePaths = changedPaths(source);
    const relatedRef =
      related && related.score > 0
        ? `；发现同领域关联事项 vllm-ascend #${related.target.number}`
        : "";
    const level =
      Boolean(source.important) ||
      /rfc|regression|breaking|security|critical/i.test(source.title)
        ? "high"
        : "medium";
    const analysis = `规则初判：vLLM 的 ${source.domain} 变化可能影响 Ascend 适配层。建议核对 ${architecture.ascendPaths
      .slice(0, 2)
      .join("、")}${relatedRef}。`;
    const id = `impact:${source.id}:vllm-ascend`;
    await run(
      env,
      `INSERT INTO cross_repo_impacts(
        id, source_item_id, target_repo_id, domain, level, status, analysis,
        changed_paths_json, target_paths_json, related_item_id, evidence_json,
        generated_by, created_at, updated_at
      ) VALUES(?, ?, 'vllm-ascend', ?, ?, 'possibly_affected', ?, ?, ?, ?, ?, 'rules', ?, ?)
      ON CONFLICT(source_item_id, target_repo_id) DO UPDATE SET
        domain = excluded.domain,
        level = excluded.level,
        status = CASE
          WHEN cross_repo_impacts.status IN ('unreviewed', 'possibly_affected')
            THEN excluded.status
          ELSE cross_repo_impacts.status
        END,
        analysis = excluded.analysis,
        changed_paths_json = excluded.changed_paths_json,
        target_paths_json = excluded.target_paths_json,
        related_item_id = excluded.related_item_id,
        evidence_json = excluded.evidence_json,
        updated_at = excluded.updated_at`,
      [
        id,
        source.id,
        source.domain,
        level,
        analysis,
        JSON.stringify(sourcePaths),
        JSON.stringify(architecture.ascendPaths),
        related && related.score > 0 ? related.target.id : null,
        JSON.stringify([
          `${source.repo_id}#${source.number}`,
          ...sourcePaths,
          ...(related && related.score > 0
            ? [`vllm-ascend#${related.target.number}`]
            : []),
        ]),
        now,
        now,
      ],
    );
  }
  await run(
    env,
    `DELETE FROM cross_repo_impacts
     WHERE generated_by = 'rules'
       AND status IN ('unreviewed', 'possibly_affected')
       AND source_item_id NOT IN (
         SELECT id FROM community_items
         WHERE repo_id = 'vllm' AND domain != 'Other'
         ORDER BY important DESC, updated_at DESC
         LIMIT 20
       )`,
  );
  return sources.length;
}

export async function listCrossRepoImpacts(env: WorkerEnv) {
  const rows = await query<Record<string, any>>(
    env,
    `SELECT
      cross_repo_impacts.*,
      source.repo_id AS source_repo,
      source.kind AS source_kind,
      source.number AS source_number,
      source.title AS source_title,
      source.html_url AS source_html_url,
      related.repo_id AS related_repo,
      related.kind AS related_kind,
      related.number AS related_number,
      related.title AS related_title
     FROM cross_repo_impacts
     JOIN community_items source
       ON source.id = cross_repo_impacts.source_item_id
     LEFT JOIN community_items related
       ON related.id = cross_repo_impacts.related_item_id
     ORDER BY
       CASE cross_repo_impacts.level
         WHEN 'critical' THEN 0 WHEN 'high' THEN 1
         WHEN 'medium' THEN 2 ELSE 3
       END,
       cross_repo_impacts.updated_at DESC
     LIMIT 50`,
  );
  return rows.map((row) => ({
    id: row.id,
    source: {
      repo: row.source_repo,
      kind: row.source_kind,
      number: Number(row.source_number),
      title: row.source_title,
      htmlUrl: row.source_html_url,
    },
    domain: row.domain,
    level: row.level,
    status: row.status,
    analysis: row.analysis,
    changedPaths: parseJson(row.changed_paths_json, []),
    ascendPaths: parseJson(row.target_paths_json, []),
    evidence: parseJson(row.evidence_json, []),
    generatedBy: row.generated_by,
    relatedItem: row.related_item_id
      ? {
          repo: row.related_repo,
          kind: row.related_kind,
          number: Number(row.related_number),
          title: row.related_title,
        }
      : null,
    updatedAt: row.updated_at,
  }));
}

export async function updateCrossRepoImpactStatus(
  env: WorkerEnv,
  id: string,
  status: string,
) {
  const allowed = new Set([
    "unreviewed",
    "possibly_affected",
    "needs_adaptation",
    "in_progress",
    "adapted",
    "not_applicable",
  ]);
  if (!allowed.has(status)) return null;
  const existing = await first<{ id: string }>(
    env,
    "SELECT id FROM cross_repo_impacts WHERE id = ?",
    [id],
  );
  if (!existing) return null;
  await run(
    env,
    "UPDATE cross_repo_impacts SET status = ?, updated_at = ? WHERE id = ?",
    [status, new Date().toISOString(), id],
  );
  return first<Record<string, any>>(
    env,
    "SELECT * FROM cross_repo_impacts WHERE id = ?",
    [id],
  );
}
