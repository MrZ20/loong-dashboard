import {
  clearSessionCookie,
  createDevelopmentSession,
  getAuthenticatedUser,
  requireUser,
} from "./auth";
import {
  answerChat,
  analyzeCommunityItem,
  generateAnalysisDocument,
} from "./ai";
import {
  first,
  initializeDatabase,
  mapAnalysis,
  mapCommunityItem,
  mapTechnicalDocument,
  parseJson,
  query,
  run,
  type WorkerEnv,
} from "./db";
import { createDailyDomainSnapshot, listDomains } from "./domains";
import {
  diffToText,
  ensurePullPatches,
  ensurePullStats,
  syncRepository,
} from "./github";
import {
  deduplicateObservedEvents,
  getTodaySummary,
  listCrossRepoImpacts,
  refreshCrossRepoImpacts,
  updateCrossRepoImpactStatus,
} from "./intelligence";
import {
  cleanText,
  handleError,
  HttpError,
  json,
  noContent,
  readJson,
  requireMethod,
} from "./http";
import { handleSettings } from "./settings";
import { beijingDate, beijingDayWindow } from "./time";

function pathMatch(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

function isKnownApiPath(path: string) {
  const exactPaths = new Set([
    "/api/health",
    "/api/auth/providers",
    "/api/auth/me",
    "/api/auth/dev-login",
    "/api/auth/logout",
    "/api/repositories",
    "/api/community",
    "/api/today",
    "/api/impacts",
    "/api/watchlist",
    "/api/analyses",
    "/api/analyses/generate",
    "/api/domains",
    "/api/documents",
    "/api/chat/threads",
  ]);
  if (exactPaths.has(path)) return true;
  return [
    /^\/api\/repositories\/[^/]+\/sync$/,
    /^\/api\/community\/[^/]+\/(pr|issue)\/\d+(\/(analyze|diff-files))?$/,
    /^\/api\/watchlist\/.+$/,
    /^\/api\/analyses\/[^/]+$/,
    /^\/api\/impacts\/[^/]+$/,
    /^\/api\/domains\/[^/]+\/snapshot$/,
    /^\/api\/documents\/[^/]+$/,
    /^\/api\/settings\/(profile|accounts|ai-providers)$/,
    /^\/api\/settings\/accounts\/[^/]+\/switch$/,
    /^\/api\/settings\/ai-providers\/[^/]+(\/activate)?$/,
    /^\/api\/chat\/threads\/[^/]+$/,
    /^\/api\/chat\/threads\/[^/]+\/messages$/,
  ].some((pattern) => pattern.test(path));
}

function toIsoDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

async function listCommunity(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  const repo = url.searchParams.get("repo");
  const kind = url.searchParams.get("kind");
  const domain = url.searchParams.get("domain");
  const state = url.searchParams.get("state");
  const search = url.searchParams.get("q")?.trim();
  const since = toIsoDate(url.searchParams.get("since"));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 200);

  if (repo) {
    conditions.push("repo_id = ?");
    bindings.push(repo);
  }
  if (kind === "pr" || kind === "issue") {
    conditions.push("kind = ?");
    bindings.push(kind);
  }
  if (domain) {
    conditions.push("domain = ?");
    bindings.push(domain);
  }
  if (state) {
    conditions.push("state = ?");
    bindings.push(state);
  }
  if (since) {
    conditions.push("updated_at >= ?");
    bindings.push(since);
  }
  if (search) {
    conditions.push("(title LIKE ? OR body_md LIKE ? OR author LIKE ?)");
    const like = `%${search.slice(0, 100)}%`;
    bindings.push(like, like, like);
  }

  const rows = await query<Record<string, any>>(
    env,
    `SELECT community_items.*,
       (
         SELECT event_type FROM community_events
         WHERE community_events.item_id = community_items.id
           AND event_type != 'updated'
         ORDER BY occurred_at DESC, id DESC LIMIT 1
       ) AS last_event_type,
       (
         SELECT occurred_at FROM community_events
         WHERE community_events.item_id = community_items.id
           AND event_type != 'updated'
         ORDER BY occurred_at DESC, id DESC LIMIT 1
       ) AS last_event_at
     FROM community_items
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY important DESC, updated_at DESC
     LIMIT ?`,
    [...bindings, limit],
  );
  return json({
    items: rows.map((row) => mapCommunityItem(row)),
    total: rows.length,
  });
}

async function getCommunityItem(
  request: Request,
  env: WorkerEnv,
  repo: string,
  kind: string,
  numberValue: string,
) {
  const number = Number(numberValue);
  if (!Number.isInteger(number)) throw new HttpError(400, "编号不正确");
  let item = await first<Record<string, any>>(
    env,
    `SELECT community_items.*,
      (
        SELECT event_type FROM community_events
        WHERE community_events.item_id = community_items.id
          AND event_type != 'updated'
        ORDER BY occurred_at DESC, id DESC LIMIT 1
      ) AS last_event_type,
      (
        SELECT occurred_at FROM community_events
        WHERE community_events.item_id = community_items.id
          AND event_type != 'updated'
        ORDER BY occurred_at DESC, id DESC LIMIT 1
      ) AS last_event_at
     FROM community_items
     WHERE repo_id = ? AND kind = ? AND number = ?`,
    [repo, kind, number],
  );
  if (!item) throw new HttpError(404, "社区条目不存在");

  if (kind === "pr") {
    const refreshed = await ensurePullStats(env, repo, number);
    item = {
      ...item,
      diff_json: JSON.stringify(refreshed.diff),
      domain: refreshed.domain,
      domain_source: refreshed.domainAssessment?.source ?? item.domain_source,
      domain_confidence:
        refreshed.domainAssessment?.confidence ?? item.domain_confidence,
      domain_evidence_json: JSON.stringify(
        refreshed.domainAssessment ?? {},
      ),
      review_signal_json: JSON.stringify(refreshed.reviewSignal ?? {}),
      review_signal_updated_at:
        refreshed.reviewSignalUpdatedAt ?? item.review_signal_updated_at,
    };
  }

  const analyses = await query<Record<string, any>>(
    env,
    `SELECT * FROM analysis_documents
     WHERE type = ? AND scope = ?
     ORDER BY updated_at DESC LIMIT 10`,
    [kind, `${repo}:${kind}:${number}`],
  );
  return json({
    item: mapCommunityItem(
      item,
      kind === "pr" ? "stats" : "none",
    ),
    analyses: analyses.map(mapAnalysis),
  });
}

async function getCommunityDiffFiles(
  env: WorkerEnv,
  repo: string,
  numberValue: string,
) {
  const number = Number(numberValue);
  if (!Number.isInteger(number)) throw new HttpError(400, "编号不正确");
  return json(await ensurePullPatches(env, repo, number));
}

async function analyzeItem(
  request: Request,
  env: WorkerEnv,
  repo: string,
  kind: string,
  numberValue: string,
) {
  const user = await requireUser(request, env);
  const body = await readJson<{ prompt?: string }>(request);
  const number = Number(numberValue);
  let row = await first<Record<string, any>>(
    env,
    "SELECT * FROM community_items WHERE repo_id = ? AND kind = ? AND number = ?",
    [repo, kind, number],
  );
  if (!row) throw new HttpError(404, "社区条目不存在");
  let diff = parseJson<{
    entries?: Array<{ path: string; additions: number; deletions: number }>;
    files?: number;
    additions?: number;
    deletions?: number;
  } | null>(row.diff_json, null);
  let analysisDiffText = diffToText(diff);
  if (kind === "pr") {
    const refreshed = await ensurePullStats(env, repo, number);
    diff = refreshed.diff ?? null;
    const patches = await ensurePullPatches(env, repo, number);
    const domainAssessment = refreshed.domainAssessment;
    const reviewSignal = refreshed.reviewSignal;
    analysisDiffText = [
      domainAssessment
        ? [
            `领域判断：${domainAssessment.domain}`,
            `判断来源：${domainAssessment.source}`,
            `置信度：${Math.round(Number(domainAssessment.confidence ?? 0) * 100)}%`,
            domainAssessment.matchedPaths?.length
              ? `路径证据：${domainAssessment.matchedPaths.join(", ")}`
              : "路径证据：尚未命中已配置规则",
          ].join("\n")
        : "",
      reviewSignal
        ? [
            `Review 建议：${reviewSignal.label}`,
            `CI：${reviewSignal.ciStatus}`,
            `合并状态：${reviewSignal.mergeability}`,
            `Review 决策：${reviewSignal.reviewDecision}`,
            `落后目标分支：${reviewSignal.behindBy ?? "未知"}`,
            `事实依据：${reviewSignal.reasons?.join("；") || "信号待补全"}`,
          ].join("\n")
        : "",
      diffToText(diff),
      ...patches.entries.map(
        (entry) =>
          `diff -- ${entry.path}\n${entry.patch ?? "[GitHub 未返回文本 patch]"}`,
      ),
      patches.skippedLarge
        ? `${patches.skippedLarge} 个超过 1000 行的文件未读取代码内容。`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const fallback = `# ${row.title} · 深度分析

## 改动目的

${row.ai_summary || "该条目尚未生成 AI 摘要。"}

## 本次关注点

${cleanText(body.prompt, 5_000) || "未提供额外分析要求。"}

## 实现与代码路径

${diff?.entries?.length
  ? diff.entries.map((entry: any) => `- \`${entry.path}\`：+${entry.additions} / -${entry.deletions}`).join("\n")
  : "- 尚未按需获取代码 diff；当前分析仅依据标题与 Markdown 正文。"}

## 兼容性与风险

- 需要结合正文和测试结果确认真实影响。
- 涉及设备扩展点时，应对照 vLLM 与 vLLM-Ascend 的对应路径。

## 建议动作

1. 当前未配置模型；请在详情页点击“获取代码修改”后人工核对具体实现。
2. 核对新增测试是否覆盖多卡和异常路径。
3. 对仍缺少证据的判断标记为待确认。`;
  const result = await analyzeCommunityItem(env, {
    userId: user.id,
    title: row.title,
    bodyMd: row.body_md,
    diffText: analysisDiffText,
    prompt: cleanText(body.prompt, 5_000),
    fallback,
  });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const scope = `${repo}:${kind}:${number}`;
  await run(
    env,
    `INSERT INTO analysis_documents (
      id, type, scope, title, summary_md, content_md, prompt, model, status,
      created_by, source_refs_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    [
      id,
      kind,
      scope,
      `${row.title} · 深度分析`,
      result.content.split("\n\n")[0].slice(0, 500),
      result.content,
      cleanText(body.prompt, 5_000),
      result.model,
      user.id,
      JSON.stringify([scope]),
      now,
      now,
    ],
  );
  const saved = await first<Record<string, any>>(
    env,
    "SELECT * FROM analysis_documents WHERE id = ?",
    [id],
  );
  return json(
    {
      analysis: mapAnalysis(saved!),
      provider: result.provider,
      providerName: result.providerName,
    },
    { status: 201 },
  );
}

async function generateAnalysis(request: Request, env: WorkerEnv) {
  const user = await requireUser(request, env);
  const body = await readJson<{
    type?: string;
    scope?: string;
    prompt?: string;
    title?: string;
  }>(request);
  const type = cleanText(body.type, 40) || "insight";
  const scope = cleanText(body.scope, 80) || "all";
  const prompt = cleanText(body.prompt, 8_000);
  const dayWindow = type === "daily" ? beijingDayWindow() : null;
  const rawRows = dayWindow
    ? await query<Record<string, any>>(
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
        [scope, scope, dayWindow.start, dayWindow.end],
      )
    : await query<Record<string, any>>(
        env,
        `SELECT repo_id, kind, number, title, domain, ai_summary,
          summary_source, updated_at
         FROM community_items
         WHERE (? = 'all' OR repo_id = ?)
         ORDER BY updated_at DESC LIMIT 80`,
        [scope, scope],
      );
  const rows = dayWindow
    ? deduplicateObservedEvents(rawRows)
    : rawRows;
  const [watchRows, impactRows] =
    type === "insight"
      ? await Promise.all([
          query<Record<string, any>>(
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
            [user.id],
          ),
          query<Record<string, any>>(
            env,
            `SELECT source.repo_id, source.kind, source.number, source.title,
              cross_repo_impacts.domain, cross_repo_impacts.level,
              cross_repo_impacts.status, cross_repo_impacts.analysis
             FROM cross_repo_impacts
             JOIN community_items source
               ON source.id = cross_repo_impacts.source_item_id
             ORDER BY cross_repo_impacts.updated_at DESC
             LIMIT 30`,
          ),
        ])
      : [[], []];
  const domainCounts = new Map<string, number>();
  for (const item of rows) {
    if (item.domain && item.domain !== "Other") {
      domainCounts.set(item.domain, (domainCounts.get(item.domain) ?? 0) + 1);
    }
  }
  const communityEvidence = rows
    .map(
      (item) =>
        `- ${item.repo_id} ${item.kind} #${item.number} [${item.domain}] ${item.title}${
          item.event_type
            ? `\n  事件：${item.event_type} @ ${item.occurred_at}`
            : ""
        }\n  ${item.summary_source === "ai" ? "AI 摘要" : "正文摘录"}：${item.ai_summary}`,
    )
    .join("\n");
  const watchEvidence = watchRows
    .map(
      (item) =>
        `- ${item.priority} ${item.repo_id} ${item.kind} #${item.number}：${item.title}\n  关注原因：${item.reason}${item.note ? `；备注：${item.note}` : ""}`,
    )
    .join("\n");
  const impactEvidence = impactRows
    .map(
      (item) =>
        `- ${item.level}/${item.status} ${item.repo_id} ${item.kind} #${item.number} [${item.domain}]：${item.title}\n  ${item.analysis}`,
    )
    .join("\n");
  const domainEvidence = [...domainCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([domain, count]) => `- ${domain}：${count} 条活动记录`)
    .join("\n");
  const evidence = [
    `## 社区事项\n${communityEvidence || "- 暂无已同步事项"}`,
    type === "insight"
      ? `## 关注列表\n${watchEvidence || "- 暂无关注项"}`
      : "",
    type === "insight"
      ? `## 跨仓库影响\n${impactEvidence || "- 暂无待确认关系"}`
      : "",
    `## 领域活动\n${domainEvidence || "- 暂无可归类活动"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const fallback = `# ${type === "daily" ? "每日社区分析" : "跨仓库 AI 洞察"}

## 执行摘要

当前服务未配置 AI API，以下内容由已同步的结构化信号生成。

## 重要变化

${rows.slice(0, 8).map((item) => `- **${item.repo_id}#${item.number}**：${item.title}`).join("\n") || "- 当前时间范围没有已同步事项。"}

${impactRows.length ? `## 跨仓库待确认\n\n${impactRows.slice(0, 5).map((item) => `- **${item.repo_id}#${item.number}**（${item.level}/${item.status}）：${item.analysis}`).join("\n")}` : ""}

## 风险与不确定性

- 尚未配置模型，无法对完整正文与代码 diff 做语义推断。
- GitHub 同步时间和 diff 完整度会影响分析结果。

## 建议动作

1. 配置 AI API 后重新生成本文档。
2. 先处理已标记为重点的回归和跨仓库适配关系。
3. 对结论保持人工确认。`;
  const result = await generateAnalysisDocument(env, {
    userId: user.id,
    type,
    scope,
    prompt,
    evidence,
    fallback,
  });
  const now = new Date().toISOString();
  const reportDate = beijingDate();
  const id = crypto.randomUUID();
  const title =
    cleanText(body.title, 200) ||
    `${type === "daily" ? `${scope} 每日分析` : "跨仓库 AI 洞察"} · ${reportDate}`;
  await run(
    env,
    `INSERT INTO analysis_documents (
      id, type, scope, title, summary_md, content_md, prompt, model, status,
      created_by, source_refs_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    [
      id,
      type,
      scope,
      title,
      result.content.split("\n\n").slice(0, 2).join("\n\n").slice(0, 1_000),
      result.content,
      prompt,
      result.model,
      user.id,
      JSON.stringify(
        [
          ...rows.slice(0, 20).map((item) => `${item.repo_id}#${item.number}`),
          ...watchRows
            .slice(0, 10)
            .map((item) => `watch:${item.repo_id}#${item.number}`),
          ...impactRows
            .slice(0, 10)
            .map((item) => `impact:${item.repo_id}#${item.number}`),
        ],
      ),
      now,
      now,
    ],
  );
  const saved = await first<Record<string, any>>(
    env,
    "SELECT * FROM analysis_documents WHERE id = ?",
    [id],
  );
  return json(
    {
      analysis: mapAnalysis(saved!),
      provider: result.provider,
      providerName: result.providerName,
    },
    { status: 201 },
  );
}

async function handleWatchlist(request: Request, env: WorkerEnv, itemId?: string) {
  const user = await requireUser(request, env);
  if (!itemId) {
    requireMethod(request, ["GET"]);
    const rows = await query<Record<string, any>>(
      env,
      `SELECT community_items.*, watchlist.reason, watchlist.note,
        watchlist.priority, watchlist.next_check, watchlist.created_at AS watched_at
       FROM watchlist
       JOIN community_items ON community_items.id = watchlist.item_id
       WHERE watchlist.user_id = ?
       ORDER BY
         CASE watchlist.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1
           WHEN 'P2' THEN 2 ELSE 3 END,
         watchlist.created_at DESC`,
      [user.id],
    );
    return json({
      items: rows.map((row) => ({
        ...mapCommunityItem(row),
        watch: {
          reason: row.reason,
          note: row.note,
          priority: row.priority,
          nextCheck: row.next_check,
          createdAt: row.watched_at,
        },
      })),
    });
  }

  const item = await first(env, "SELECT id FROM community_items WHERE id = ?", [itemId]);
  if (!item) throw new HttpError(404, "社区条目不存在");
  if (request.method === "DELETE") {
    await run(env, "DELETE FROM watchlist WHERE user_id = ? AND item_id = ?", [
      user.id,
      itemId,
    ]);
    return noContent();
  }

  requireMethod(request, ["POST"]);
  const body = await readJson<{
    reason?: string;
    note?: string;
    priority?: string;
    nextCheck?: string;
  }>(request);
  const priority = ["P0", "P1", "P2", "P3"].includes(body.priority ?? "")
    ? body.priority
    : "P2";
  await run(
    env,
    `INSERT INTO watchlist (
      user_id, item_id, reason, note, priority, next_check, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, item_id) DO UPDATE SET
      reason = excluded.reason, note = excluded.note,
      priority = excluded.priority, next_check = excluded.next_check`,
    [
      user.id,
      itemId,
      cleanText(body.reason, 120) || "持续关注",
      cleanText(body.note, 1_000),
      priority,
      cleanText(body.nextCheck, 80) || null,
      new Date().toISOString(),
    ],
  );
  return json({ ok: true }, { status: 201 });
}

async function handleAnalyses(request: Request, env: WorkerEnv, id?: string) {
  await requireUser(request, env);
  if (id) {
    requireMethod(request, ["GET"]);
    const row = await first<Record<string, any>>(
      env,
      "SELECT * FROM analysis_documents WHERE id = ?",
      [id],
    );
    if (!row) throw new HttpError(404, "分析文档不存在");
    return json({ analysis: mapAnalysis(row) });
  }

  requireMethod(request, ["GET"]);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const scope = url.searchParams.get("scope");
  const rows = await query<Record<string, any>>(
    env,
    `SELECT * FROM analysis_documents
     WHERE (? IS NULL OR type = ?) AND (? IS NULL OR scope = ?)
     ORDER BY updated_at DESC LIMIT 100`,
    [type, type, scope, scope],
  );
  return json({ analyses: rows.map(mapAnalysis) });
}

async function handleDocuments(request: Request, env: WorkerEnv, id?: string) {
  const user = await requireUser(request, env);
  if (!id) {
    if (request.method === "GET") {
      const category = new URL(request.url).searchParams.get("category");
      const rows = await query<Record<string, any>>(
        env,
        `SELECT * FROM technical_documents
         WHERE (? IS NULL OR category = ?)
         ORDER BY category, updated_at DESC`,
        [category, category],
      );
      return json({ documents: rows.map(mapTechnicalDocument) });
    }
    requireMethod(request, ["POST"]);
    const body = await readJson<Record<string, unknown>>(request);
    const title = cleanText(body.title, 200);
    const category = cleanText(body.category, 80);
    const contentMd = cleanText(body.contentMd, 200_000);
    if (!title || !category || !contentMd) {
      throw new HttpError(400, "标题、技术分类和 Markdown 正文不能为空");
    }
    const idValue = crypto.randomUUID();
    const slug =
      cleanText(body.slug, 120) ||
      `${category}-${title}-${idValue.slice(0, 8)}`
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
    const now = new Date().toISOString();
    await run(
      env,
      `INSERT INTO technical_documents (
        id, category, slug, title, summary, content_md, tags_json,
        source_refs_json, author_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idValue,
        category,
        slug,
        title,
        cleanText(body.summary, 500),
        contentMd,
        JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 20) : []),
        JSON.stringify(
          Array.isArray(body.sourceRefs) ? body.sourceRefs.slice(0, 50) : [],
        ),
        user.id,
        now,
        now,
      ],
    );
    const created = await first<Record<string, any>>(
      env,
      "SELECT * FROM technical_documents WHERE id = ?",
      [idValue],
    );
    return json({ document: mapTechnicalDocument(created!) }, { status: 201 });
  }

  const row = await first<Record<string, any>>(
    env,
    "SELECT * FROM technical_documents WHERE id = ? OR slug = ?",
    [id, id],
  );
  if (!row) throw new HttpError(404, "技术文档不存在");
  if (request.method === "GET") {
    return json({ document: mapTechnicalDocument(row) });
  }
  if (request.method === "DELETE") {
    await run(env, "DELETE FROM technical_documents WHERE id = ?", [row.id]);
    return noContent();
  }

  requireMethod(request, ["PUT"]);
  const body = await readJson<Record<string, unknown>>(request);
  const title = cleanText(body.title, 200) || row.title;
  const category = cleanText(body.category, 80) || row.category;
  const contentMd = cleanText(body.contentMd, 200_000) || row.content_md;
  await run(
    env,
    `UPDATE technical_documents SET
      title = ?, category = ?, summary = ?, content_md = ?, tags_json = ?,
      source_refs_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      title,
      category,
      cleanText(body.summary, 500) || row.summary,
      contentMd,
      JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 20) : parseJson(row.tags_json, [])),
      JSON.stringify(
        Array.isArray(body.sourceRefs)
          ? body.sourceRefs.slice(0, 50)
          : parseJson(row.source_refs_json, []),
      ),
      new Date().toISOString(),
      row.id,
    ],
  );
  const updated = await first<Record<string, any>>(
    env,
    "SELECT * FROM technical_documents WHERE id = ?",
    [row.id],
  );
  return json({ document: mapTechnicalDocument(updated!) });
}

async function handleChat(request: Request, env: WorkerEnv, path: string) {
  const user = await requireUser(request, env);
  if (path === "/api/chat/threads") {
    if (request.method === "GET") {
      const rows = await query<Record<string, any>>(
        env,
        `SELECT * FROM chat_threads WHERE user_id = ?
         ORDER BY updated_at DESC LIMIT 100`,
        [user.id],
      );
      return json({
        threads: rows.map((row) => ({
          id: row.id,
          title: row.title,
          context: parseJson(row.context_json, {}),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      });
    }
    requireMethod(request, ["POST"]);
    const body = await readJson<{ title?: string; context?: unknown }>(request);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await run(
      env,
      `INSERT INTO chat_threads(
        id, user_id, title, context_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?)`,
      [
        id,
        user.id,
        cleanText(body.title, 120) || "新对话",
        JSON.stringify(body.context ?? {}),
        now,
        now,
      ],
    );
    return json(
      {
        thread: {
          id,
          title: cleanText(body.title, 120) || "新对话",
          context: body.context ?? {},
          createdAt: now,
          updatedAt: now,
        },
      },
      { status: 201 },
    );
  }

  const threadMatch = pathMatch(path, /^\/api\/chat\/threads\/([^/]+)$/);
  if (threadMatch) {
    const [threadId] = threadMatch;
    const thread = await first<Record<string, any>>(
      env,
      "SELECT * FROM chat_threads WHERE id = ? AND user_id = ?",
      [threadId, user.id],
    );
    if (!thread) throw new HttpError(404, "对话不存在");
    if (request.method === "DELETE") {
      await run(env, "DELETE FROM chat_messages WHERE thread_id = ?", [threadId]);
      await run(
        env,
        "DELETE FROM chat_threads WHERE id = ? AND user_id = ?",
        [threadId, user.id],
      );
      return noContent();
    }
    requireMethod(request, ["PUT"]);
    const body = await readJson<{ title?: string }>(request);
    const title = cleanText(body.title, 120);
    if (!title) throw new HttpError(400, "对话标题不能为空");
    const updatedAt = new Date().toISOString();
    await run(
      env,
      "UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      [title, updatedAt, threadId, user.id],
    );
    return json({
      thread: {
        id: threadId,
        title,
        context: parseJson(thread.context_json, {}),
        createdAt: thread.created_at,
        updatedAt,
      },
    });
  }

  const match = pathMatch(path, /^\/api\/chat\/threads\/([^/]+)\/messages$/);
  if (!match) throw new HttpError(404, "对话接口不存在");
  const [threadId] = match;
  const thread = await first<Record<string, any>>(
    env,
    "SELECT * FROM chat_threads WHERE id = ? AND user_id = ?",
    [threadId, user.id],
  );
  if (!thread) throw new HttpError(404, "对话不存在");

  if (request.method === "GET") {
    const rows = await query<Record<string, any>>(
      env,
      `SELECT * FROM chat_messages WHERE thread_id = ?
       ORDER BY created_at ASC`,
      [threadId],
    );
    return json({
      messages: rows.map((row) => ({
        id: row.id,
        role: row.role,
        contentMd: row.content_md,
        context: parseJson(row.context_json, {}),
        createdAt: row.created_at,
      })),
    });
  }

  requireMethod(request, ["POST"]);
  const body = await readJson<{
    content?: string;
    pageContext?: string;
    selection?: string;
  }>(request);
  const content = cleanText(body.content, 20_000);
  if (!content) throw new HttpError(400, "问题不能为空");
  const now = new Date().toISOString();
  const userMessageId = crypto.randomUUID();
  const context = {
    pageContext: cleanText(body.pageContext, 20_000),
    selection: cleanText(body.selection, 8_000),
  };
  await run(
    env,
    `INSERT INTO chat_messages(
      id, thread_id, role, content_md, context_json, created_at
    ) VALUES(?, ?, 'user', ?, ?, ?)`,
    [userMessageId, threadId, content, JSON.stringify(context), now],
  );
  const historyRows = await query<Record<string, any>>(
    env,
    `SELECT role, content_md FROM chat_messages
     WHERE thread_id = ? ORDER BY created_at ASC LIMIT 50`,
    [threadId],
  );
  const result = await answerChat(env, {
    userId: user.id,
    messages: historyRows.map((row) => ({
      role: row.role,
      content: row.content_md,
    })),
    pageContext: context.pageContext,
    selection: context.selection,
  });
  const assistantId = crypto.randomUUID();
  const assistantAt = new Date().toISOString();
  await run(
    env,
    `INSERT INTO chat_messages(
      id, thread_id, role, content_md, context_json, created_at
    ) VALUES(?, ?, 'assistant', ?, ?, ?)`,
    [
      assistantId,
      threadId,
      result.content,
      JSON.stringify({
        model: result.model,
        provider: result.provider,
        providerName: result.providerName,
      }),
      assistantAt,
    ],
  );
  await run(
    env,
    "UPDATE chat_threads SET updated_at = ?, title = CASE WHEN title = '新对话' THEN ? ELSE title END WHERE id = ?",
    [assistantAt, content.slice(0, 50), threadId],
  );
  return json(
    {
      userMessage: { id: userMessageId, role: "user", contentMd: content, createdAt: now },
      assistantMessage: {
        id: assistantId,
        role: "assistant",
        contentMd: result.content,
        createdAt: assistantAt,
      },
      provider: result.provider,
      providerName: result.providerName,
    },
    { status: 201 },
  );
}

async function handleApi(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") {
    return json({
      ok: true,
      database: Boolean(env.DB),
      aiConfigured: Boolean(env.AI_API_KEY),
      githubConfigured: Boolean(env.GITHUB_TOKEN),
      timestamp: new Date().toISOString(),
    });
  }
  if (path === "/api/auth/providers") {
    return json({
      mode: env.ALLOW_DEV_AUTH === "true" ? "development" : "chatgpt",
      signInPath: "/signin-with-chatgpt?return_to=/",
      signOutPath: "/signout-with-chatgpt?return_to=/login",
    });
  }

  await initializeDatabase(env);

  if (path === "/api/auth/me") {
    requireMethod(request, ["GET"]);
    const user = await getAuthenticatedUser(request, env);
    if (!user) throw new HttpError(401, "请先登录");
    return json({ user });
  }
  if (path === "/api/auth/dev-login") {
    requireMethod(request, ["POST"]);
    const body = await readJson<{
      email?: string;
      displayName?: string;
      password?: string;
    }>(request);
    const cookie = await createDevelopmentSession(
      env,
      cleanText(body.email, 200),
      cleanText(body.displayName, 100),
      cleanText(body.password, 500),
      new URL(request.url).protocol === "https:",
    );
    return json({ ok: true }, { headers: { "set-cookie": cookie } });
  }
  if (path === "/api/auth/logout") {
    requireMethod(request, ["POST"]);
    return json(
      { ok: true },
      {
        headers: {
          "set-cookie": clearSessionCookie(
            new URL(request.url).protocol === "https:",
          ),
        },
      },
    );
  }

  const repositorySync = pathMatch(path, /^\/api\/repositories\/([^/]+)\/sync$/);
  if (repositorySync) {
    requireMethod(request, ["POST"]);
    const user = await requireUser(request, env);
    const syncRun = await syncRepository(env, repositorySync[0], user.id);
    await refreshCrossRepoImpacts(env);
    return json({ run: syncRun });
  }
  if (path === "/api/repositories") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    const rows = await query<Record<string, any>>(
      env,
      "SELECT * FROM repositories WHERE enabled = 1 ORDER BY id",
    );
    return json({
      repositories: rows.map((row) => ({
        id: row.id,
        owner: row.owner,
        name: row.name,
        openPulls: Number(row.open_pull_count ?? 0),
        openIssues: Number(row.open_issue_count ?? 0),
        lastSyncedAt: row.last_synced_at,
        syncStatus: row.sync_status,
      })),
    });
  }

  if (path === "/api/community") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return listCommunity(request, env);
  }
  if (path === "/api/today") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    const repo = new URL(request.url).searchParams.get("repo");
    if (!repo) throw new HttpError(400, "缺少仓库参数");
    return json({ summary: await getTodaySummary(env, repo) });
  }
  if (path === "/api/impacts") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return json({ impacts: await listCrossRepoImpacts(env) });
  }
  const impactDetail = pathMatch(path, /^\/api\/impacts\/([^/]+)$/);
  if (impactDetail) {
    requireMethod(request, ["PATCH"]);
    await requireUser(request, env);
    const body = await readJson<{ status?: string }>(request);
    const impact = await updateCrossRepoImpactStatus(
      env,
      impactDetail[0],
      cleanText(body.status, 40),
    );
    if (!impact) throw new HttpError(404, "影响关系不存在或状态无效");
    return json({ ok: true });
  }
  const communityDiffFiles = pathMatch(
    path,
    /^\/api\/community\/([^/]+)\/pr\/(\d+)\/diff-files$/,
  );
  if (communityDiffFiles) {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return getCommunityDiffFiles(
      env,
      communityDiffFiles[0],
      communityDiffFiles[1],
    );
  }
  const communityAnalyze = pathMatch(
    path,
    /^\/api\/community\/([^/]+)\/(pr|issue)\/(\d+)\/analyze$/,
  );
  if (communityAnalyze) {
    requireMethod(request, ["POST"]);
    return analyzeItem(
      request,
      env,
      communityAnalyze[0],
      communityAnalyze[1],
      communityAnalyze[2],
    );
  }
  const communityDetail = pathMatch(
    path,
    /^\/api\/community\/([^/]+)\/(pr|issue)\/(\d+)$/,
  );
  if (communityDetail) {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return getCommunityItem(
      request,
      env,
      communityDetail[0],
      communityDetail[1],
      communityDetail[2],
    );
  }

  if (path === "/api/watchlist") return handleWatchlist(request, env);
  const watchItem = pathMatch(path, /^\/api\/watchlist\/(.+)$/);
  if (watchItem) return handleWatchlist(request, env, watchItem[0]);

  if (path === "/api/analyses/generate") {
    requireMethod(request, ["POST"]);
    return generateAnalysis(request, env);
  }
  if (path === "/api/analyses") return handleAnalyses(request, env);
  const analysisDetail = pathMatch(path, /^\/api\/analyses\/([^/]+)$/);
  if (analysisDetail) return handleAnalyses(request, env, analysisDetail[0]);

  if (path === "/api/domains") {
    requireMethod(request, ["GET"]);
    await requireUser(request, env);
    return json({ domains: await listDomains(env) });
  }
  const domainSnapshot = pathMatch(
    path,
    /^\/api\/domains\/([^/]+)\/snapshot$/,
  );
  if (domainSnapshot) {
    requireMethod(request, ["POST"]);
    await requireUser(request, env);
    const snapshot = await createDailyDomainSnapshot(env, domainSnapshot[0]);
    if (!snapshot) throw new HttpError(404, "技术领域不存在");
    return json({ snapshot }, { status: 201 });
  }

  if (path === "/api/documents") return handleDocuments(request, env);
  const documentDetail = pathMatch(path, /^\/api\/documents\/([^/]+)$/);
  if (documentDetail) return handleDocuments(request, env, documentDetail[0]);

  if (path.startsWith("/api/settings/")) {
    return handleSettings(request, env, path);
  }
  if (path.startsWith("/api/chat/")) return handleChat(request, env, path);

  throw new HttpError(404, "API 接口不存在");
}

async function fetchHandler(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (!isKnownApiPath(url.pathname)) {
      return handleError(new HttpError(404, "API 接口不存在"));
    }
    try {
      return await handleApi(request, env);
    } catch (error) {
      return handleError(error);
    }
  }

  const response = await env.ASSETS.fetch(request);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (
    response.status !== 404 ||
    !acceptsHtml ||
    !["GET", "HEAD"].includes(request.method)
  ) {
    return response;
  }

  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";
  return env.ASSETS.fetch(new Request(indexUrl, request));
}

export default {
  fetch: fetchHandler,
};
