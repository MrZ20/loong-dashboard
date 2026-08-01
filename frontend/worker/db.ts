import {
  DOMAIN_ARCHITECTURES,
  SEED_ANALYSES,
  SEED_COMMUNITY_ITEMS,
  SEED_TECHNICAL_DOCUMENTS,
} from "./seed";

const databaseInitializations = new WeakMap<object, Promise<void>>();
const REQUIRED_TABLES = [
  "app_meta",
  "users",
  "user_profiles",
  "ai_providers",
  "repositories",
  "community_items",
  "community_events",
  "cross_repo_impacts",
  "watchlist",
  "analysis_documents",
  "domain_snapshots",
  "technical_documents",
  "chat_threads",
  "chat_messages",
  "sync_runs",
] as const;

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB?: any;
  AI_API_KEY?: string;
  AI_API_BASE_URL?: string;
  AI_API_MODE?: string;
  AI_MODEL?: string;
  GITHUB_TOKEN?: string;
  SESSION_SECRET?: string;
  CREDENTIALS_ENCRYPTION_KEY?: string;
  ALLOW_DEV_AUTH?: string;
  LOCAL_ADMIN_PASSWORD?: string;
  SEED_DEMO_DATA?: string;
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
  if (typeof db !== "object" || db === null) {
    await prepareDatabase(env);
    return;
  }
  let pending = databaseInitializations.get(db);
  if (!pending) {
    pending = prepareDatabase(env).catch((error) => {
      databaseInitializations.delete(db);
      throw error;
    });
    databaseInitializations.set(db, pending);
  }
  await pending;
}

async function prepareDatabase(env: WorkerEnv) {
  await verifyDatabaseSchema(env);
  await ensureCoreRepositories(env);

  const seedVersion = await first<{ value: string }>(
    env,
    "SELECT value FROM app_meta WHERE key = ?",
    ["seed_version"],
  );
  if (seedVersion?.value === "3") return;

  if (env.SEED_DEMO_DATA === "true") {
    await seedDatabase(env);
  } else {
    await run(
      env,
      `INSERT INTO app_meta(key, value, updated_at) VALUES('seed_version', '3', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [new Date().toISOString()],
    );
  }
}

async function verifyDatabaseSchema(env: WorkerEnv) {
  const tables = await query<{ name: string }>(
    env,
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const existing = new Set(tables.map((table) => table.name));
  const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
  if (missing.length) {
    throw new Error(
      `D1 数据库尚未迁移，缺少表：${missing.join(", ")}。请先执行 npm run db:migrate:local，部署环境则应用 drizzle migrations。`,
    );
  }
}

async function ensureCoreRepositories(env: WorkerEnv) {
  const now = new Date().toISOString();
  for (const [id, name] of [
    ["vllm", "vllm"],
    ["vllm-ascend", "vllm-ascend"],
  ] as const) {
    await run(
      env,
      `INSERT INTO repositories(
        id, owner, name, enabled, open_pull_count, open_issue_count,
        sync_status, created_at
      ) VALUES(?, 'vllm-project', ?, 1, 0, 0, 'idle', ?)
      ON CONFLICT(id) DO UPDATE SET
        owner = excluded.owner,
        name = excluded.name`,
      [id, name, now],
    );
  }
}

async function seedDatabase(env: WorkerEnv) {
  const now = new Date().toISOString();
  const db = requireDb(env);
  const seedCount = (repoId: string, kind: "pr" | "issue") =>
    SEED_COMMUNITY_ITEMS.filter(
      (item) => item.repoId === repoId && item.kind === kind,
    ).length;
  const statements = [
    db
      .prepare(
        `INSERT INTO repositories
          (id, owner, name, enabled, open_pull_count, open_issue_count, sync_status, created_at)
         VALUES (?, ?, ?, 1, ?, ?, 'idle', ?)
         ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, name = excluded.name`,
      )
      .bind(
        "vllm-ascend",
        "vllm-project",
        "vllm-ascend",
        seedCount("vllm-ascend", "pr"),
        seedCount("vllm-ascend", "issue"),
        now,
      ),
    db
      .prepare(
        `INSERT INTO repositories
          (id, owner, name, enabled, open_pull_count, open_issue_count, sync_status, created_at)
         VALUES (?, ?, ?, 1, ?, ?, 'idle', ?)
         ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, name = excluded.name`,
      )
      .bind(
        "vllm",
        "vllm-project",
        "vllm",
        seedCount("vllm", "pr"),
        seedCount("vllm", "issue"),
        now,
      ),
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
        `INSERT INTO app_meta(key, value, updated_at) VALUES('seed_version', '3', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(now),
  );

  await db.batch(statements);
}

export function mapCommunityItem(
  row: Record<string, any>,
  diffMode: "none" | "stats" | "full" = "none",
) {
  const storedDiff =
    diffMode === "none"
      ? null
      : parseJson<Record<string, any> | null>(row.diff_json, null);
  const diff =
    storedDiff && diffMode === "stats"
      ? {
          ...storedDiff,
          entries: Array.isArray(storedDiff.entries)
            ? storedDiff.entries.map((entry: Record<string, any>) => ({
                path: entry.path,
                additions: Number(entry.additions ?? 0),
                deletions: Number(entry.deletions ?? 0),
              }))
            : [],
          raw: undefined,
          statsOnly: true,
          complete: false,
          notice:
            storedDiff.statsOnly === true
              ? storedDiff.notice
              : "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
        }
      : storedDiff;
  const domainAssessment = parseJson<Record<string, any>>(
    row.domain_evidence_json,
    {
      domain: row.domain,
      source: row.domain_source || "text",
      confidence: Number(row.domain_confidence ?? 0),
      confidenceLabel:
        Number(row.domain_confidence ?? 0) >= 0.78
          ? "high"
          : Number(row.domain_confidence ?? 0) >= 0.52
            ? "medium"
            : "low",
      matchedPaths: [],
      matchedTerms: [],
      scores: [],
    },
  );
  const reviewSignal =
    row.kind === "pr"
      ? parseJson<Record<string, any> | null>(row.review_signal_json, null)
      : null;

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mergedAt: row.merged_at,
    closedAt: row.closed_at,
    isDraft: Boolean(row.is_draft),
    summarySource: row.summary_source || "excerpt",
    summaryUpdatedAt: row.summary_updated_at,
    lastEventType: row.last_event_type ?? null,
    lastEventAt: row.last_event_at ?? null,
    fetchedAt: row.fetched_at,
    domainAssessment,
    reviewSignal,
    reviewSignalUpdatedAt: row.review_signal_updated_at ?? null,
    diff,
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
