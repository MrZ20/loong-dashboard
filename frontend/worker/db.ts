import { indexStatements, schemaStatements } from "../db/schema";
import {
  DOMAIN_ARCHITECTURES,
  SEED_ANALYSES,
  SEED_COMMUNITY_ITEMS,
  SEED_TECHNICAL_DOCUMENTS,
} from "./seed";

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: any;
  AI_API_KEY?: string;
  AI_API_BASE_URL?: string;
  AI_API_MODE?: string;
  AI_MODEL?: string;
  GITHUB_TOKEN?: string;
  SESSION_SECRET?: string;
  ALLOW_DEV_AUTH?: string;
}

export function requireDb(env: WorkerEnv) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured");
  }
  return env.DB;
}

export async function query<T = Record<string, unknown>>(
  env: WorkerEnv,
  sql: string,
  bindings: unknown[] = [],
): Promise<T[]> {
  const db = requireDb(env);
  const statement = bindings.length ? db.prepare(sql).bind(...bindings) : db.prepare(sql);
  const result = await statement.all();
  return (result.results ?? []) as T[];
}

export async function first<T = Record<string, unknown>>(
  env: WorkerEnv,
  sql: string,
  bindings: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(env, sql, bindings);
  return rows[0] ?? null;
}

export async function run(
  env: WorkerEnv,
  sql: string,
  bindings: unknown[] = [],
) {
  const db = requireDb(env);
  const statement = bindings.length ? db.prepare(sql).bind(...bindings) : db.prepare(sql);
  return statement.run();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function initializeDatabase(env: WorkerEnv) {
  const db = requireDb(env);
  await db.batch([
    ...schemaStatements.map((statement) => db.prepare(statement)),
    ...indexStatements.map((statement) => db.prepare(statement)),
  ]);

  const seedVersion = await first<{ value: string }>(
    env,
    "SELECT value FROM app_meta WHERE key = ?",
    ["seed_version"],
  );
  if (seedVersion?.value === "2") return;

  await seedDatabase(env);
}

async function seedDatabase(env: WorkerEnv) {
  const now = new Date().toISOString();
  const db = requireDb(env);
  const statements = [
    db
      .prepare(
        `INSERT INTO repositories
          (id, owner, name, enabled, open_pull_count, open_issue_count, sync_status, created_at)
         VALUES (?, ?, ?, 1, ?, ?, 'idle', ?)
         ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, name = excluded.name`,
      )
      .bind("vllm-ascend", "vllm-project", "vllm-ascend", 86, 142, now),
    db
      .prepare(
        `INSERT INTO repositories
          (id, owner, name, enabled, open_pull_count, open_issue_count, sync_status, created_at)
         VALUES (?, ?, ?, 1, ?, ?, 'idle', ?)
         ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, name = excluded.name`,
      )
      .bind("vllm", "vllm-project", "vllm", 412, 1300, now),
  ];

  for (const item of SEED_COMMUNITY_ITEMS) {
    const diff = item.diff ?? null;
    statements.push(
      db
        .prepare(
          `INSERT INTO community_items (
            id, repo_id, kind, number, state, title, author, body_md, comments,
            domain, ai_summary, status_text, important, updated_at, fetched_at,
            diff_json, diff_files_count, additions, deletions
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            body_md = CASE WHEN community_items.fetched_at = community_items.updated_at
              THEN excluded.body_md ELSE community_items.body_md END,
            ai_summary = CASE WHEN community_items.ai_summary = ''
              THEN excluded.ai_summary ELSE community_items.ai_summary END`,
        )
        .bind(
          item.id,
          item.repoId,
          item.kind,
          item.number,
          item.state,
          item.title,
          item.author,
          item.bodyMd,
          item.comments,
          item.domain,
          item.aiSummary,
          item.statusText,
          item.important,
          item.updatedAt,
          item.updatedAt,
          diff ? JSON.stringify(diff) : null,
          diff?.files ?? 0,
          diff?.additions ?? 0,
          diff?.deletions ?? 0,
        ),
    );
  }

  for (const analysis of SEED_ANALYSES) {
    statements.push(
      db
        .prepare(
          `INSERT INTO analysis_documents (
            id, type, scope, title, summary_md, content_md, prompt, model,
            status, source_refs_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          analysis.id,
          analysis.type,
          analysis.scope,
          analysis.title,
          analysis.summaryMd,
          analysis.contentMd,
          analysis.prompt,
          analysis.model,
          JSON.stringify(analysis.refs),
          now,
          now,
        ),
    );
  }

  for (const document of SEED_TECHNICAL_DOCUMENTS) {
    statements.push(
      db
        .prepare(
          `INSERT INTO technical_documents (
            id, category, slug, title, summary, content_md, tags_json,
            source_refs_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          document.id,
          document.category,
          document.slug,
          document.title,
          document.summary,
          document.contentMd,
          JSON.stringify(document.tags),
          JSON.stringify(document.refs),
          now,
          now,
        ),
    );
  }

  const snapshotDate = now.slice(0, 10);
  for (const [domain, architecture] of Object.entries(DOMAIN_ARCHITECTURES)) {
    const architectureMd = `# ${domain} 代码架构

${architecture.description}

## 执行链

\`${architecture.pipeline}\`

## vLLM 上游核心

${architecture.upstreamPaths.map((path) => `- \`${path}\``).join("\n")}

## Ascend 适配层

${architecture.ascendPaths.map((path) => `- \`${path}\``).join("\n")}

## 验证入口

${architecture.testPaths.map((path) => `- \`${path}\``).join("\n")}

## 关键符号

${architecture.symbols.map((symbol) => `- \`${symbol}\``).join("\n")}`;
    statements.push(
      db
        .prepare(
          `INSERT INTO domain_snapshots (
            id, domain, snapshot_date, architecture_md, changed_paths_json,
            activity_json, insight_md, created_at
          ) VALUES (?, ?, ?, ?, '[]', '{}', ?, ?)
          ON CONFLICT(domain, snapshot_date) DO NOTHING`,
        )
        .bind(
          `domain-${domain.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${snapshotDate}`,
          domain,
          snapshotDate,
          architectureMd,
          `当前快照建立了 ${domain} 的长期代码架构基线。同步 PR 后，活跃路径与每日变化会追加到此基线之上。`,
          now,
        ),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO app_meta(key, value, updated_at) VALUES('seed_version', '2', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(now),
  );

  await db.batch(statements);
}

export function mapCommunityItem(row: Record<string, any>) {
  return {
    id: row.id,
    repo: row.repo_id,
    kind: row.kind,
    number: Number(row.number),
    state: row.state,
    title: row.title,
    author: row.author,
    authorAvatar: row.author_avatar,
    bodyMd: row.body_md,
    htmlUrl: row.html_url,
    comments: Number(row.comments ?? 0),
    domain: row.domain,
    aiSummary: row.ai_summary,
    statusText: row.status_text,
    important: Boolean(row.important),
    updatedAt: row.updated_at,
    mergedAt: row.merged_at,
    fetchedAt: row.fetched_at,
    diff: parseJson(row.diff_json, null),
  };
}

export function mapAnalysis(row: Record<string, any>) {
  return {
    id: row.id,
    type: row.type,
    scope: row.scope,
    title: row.title,
    summaryMd: row.summary_md,
    contentMd: row.content_md,
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    sourceRefs: parseJson(row.source_refs_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTechnicalDocument(row: Record<string, any>) {
  return {
    id: row.id,
    category: row.category,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    contentMd: row.content_md,
    tags: parseJson(row.tags_json, []),
    sourceRefs: parseJson(row.source_refs_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
