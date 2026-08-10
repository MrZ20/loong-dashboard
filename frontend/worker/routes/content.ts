import { generateTechnicalDocument } from "../ai";
import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import {
  mapAnalysis,
  mapCommunityItem,
  mapTechnicalDocument,
} from "../mappers";
import { parseJson } from "../mappers/database-row";
import {
  cleanText,
  HttpError,
  json,
  noContent,
  readJson,
  requireMethod,
} from "../http";
import {
  createDocumentRow,
  deleteDocumentRow,
  deleteWatchlistItem,
  findAnalysisRow,
  findCommunityItemId,
  findDocumentRow,
  listAnalysisRows,
  listDocumentRows,
  listWatchlistRows,
  saveWatchlistItem,
  updateDocumentRow,
} from "../repositories/content";
import { resolveAITask } from "../services/ai-task-settings";
import { enqueueManagedAITask } from "../services/local-runtime/enqueue";

export async function handleWatchlist(request: Request, env: WorkerEnv, itemId?: string) {
  const user = await requireUser(request, env);
  if (!itemId) {
    requireMethod(request, ["GET"]);
    const rows = await listWatchlistRows(env, user.id);
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

  const item = await findCommunityItemId(env, itemId);
  if (!item) throw new HttpError(404, "社区条目不存在");
  if (request.method === "DELETE") {
    await deleteWatchlistItem(env, user.id, itemId);
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
  await saveWatchlistItem(env, {
    userId: user.id,
    itemId,
    reason: cleanText(body.reason, 120) || "持续关注",
    note: cleanText(body.note, 1_000),
    priority: priority ?? "P2",
    nextCheck: cleanText(body.nextCheck, 80) || null,
    createdAt: new Date().toISOString(),
  });
  return json({ ok: true }, { status: 201 });
}

export async function handleAnalyses(request: Request, env: WorkerEnv, id?: string) {
  await requireUser(request, env);
  if (id) {
    requireMethod(request, ["GET"]);
    const row = await findAnalysisRow(env, id);
    if (!row) throw new HttpError(404, "分析文档不存在");
    return json({ analysis: mapAnalysis(row) });
  }

  requireMethod(request, ["GET"]);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const scope = url.searchParams.get("scope");
  const rows = await listAnalysisRows(env, type, scope);
  return json({ analyses: rows.map(mapAnalysis) });
}

export async function generateDocumentDraft(request: Request, env: WorkerEnv) {
  const user = await requireUser(request, env);
  requireMethod(request, ["POST"]);
  const body = await readJson<Record<string, unknown>>(request);
  const title = cleanText(body.title, 200);
  const category = cleanText(body.category, 80);
  const contentMd = cleanText(body.contentMd, 200_000);
  if (!title || !category || !contentMd) {
    throw new HttpError(400, "请先填写标题、技术分类和 Markdown 草稿");
  }
  const summary = cleanText(body.summary, 1_000);
  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag) => cleanText(tag, 80)).filter(Boolean).slice(0, 20)
    : [];
  const sourceRefs = Array.isArray(body.sourceRefs)
    ? body.sourceRefs.map((source) => cleanText(source, 500)).filter(Boolean).slice(0, 50)
    : [];
  const task = await resolveAITask(env, user.id, "technical_document_generation");
  if (task.executionMode !== "api") {
    const sourceText = sourceRefs.join("\n").toLowerCase();
    const repoScope = sourceText.includes("vllm-ascend")
      ? "vllm-ascend"
      : sourceText.includes("vllm") ? "vllm" : "all";
    const job = await enqueueManagedAITask(env, {
      userId: user.id,
      taskKey: "technical_document_generation",
      purpose: "analysis_document",
      subjectKind: "technical_document",
      subjectKey: `technical-document:${category}:${Date.now()}`,
      repoScope,
      request: {
        title,
        category,
        summary,
        contentMd,
        tags,
        sourceRefs,
        document: {
          type: "technical_document_draft",
          scope: category,
          title: `${title} · AI 草稿`,
          sourceRefs,
        },
      },
    });
    return json({ job }, { status: 202 });
  }
  const result = await generateTechnicalDocument(env, {
    userId: user.id,
    title,
    category,
    summary,
    contentMd,
    tags,
    sourceRefs,
  });
  const generatedSummary = result.content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"))
    ?.slice(0, 500) || summary;
  return json({
    draft: { contentMd: result.content, summary: generatedSummary },
    provider: result.provider,
    providerName: result.providerName,
    model: result.model,
    promptTemplateName: result.prompt.name,
    promptVersion: result.prompt.promptVersion,
    promptRevision: result.prompt.revision,
  });
}

export async function handleDocuments(request: Request, env: WorkerEnv, id?: string) {
  const user = await requireUser(request, env);
  if (!id) {
    if (request.method === "GET") {
      const category = new URL(request.url).searchParams.get("category");
      const rows = await listDocumentRows(env, category);
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
    const created = await createDocumentRow(env, {
      id: idValue,
      category,
      slug,
      title,
      summary: cleanText(body.summary, 500),
      contentMd,
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : [],
      sourceRefs: Array.isArray(body.sourceRefs)
        ? body.sourceRefs.slice(0, 50)
        : [],
      authorId: user.id,
      createdAt: now,
    });
    return json({ document: mapTechnicalDocument(created!) }, { status: 201 });
  }

  const row = await findDocumentRow(env, id);
  if (!row) throw new HttpError(404, "技术文档不存在");
  if (request.method === "GET") {
    return json({ document: mapTechnicalDocument(row) });
  }
  if (request.method === "DELETE") {
    await deleteDocumentRow(env, row.id);
    return noContent();
  }

  requireMethod(request, ["PUT"]);
  const body = await readJson<Record<string, unknown>>(request);
  const title = cleanText(body.title, 200) || row.title;
  const category = cleanText(body.category, 80) || row.category;
  const contentMd = cleanText(body.contentMd, 200_000) || row.content_md;
  const updated = await updateDocumentRow(env, {
    id: row.id,
    title,
    category,
    summary: cleanText(body.summary, 500) || row.summary,
    contentMd,
    tags: Array.isArray(body.tags)
      ? body.tags.slice(0, 20)
      : parseJson(row.tags_json, []),
    sourceRefs: Array.isArray(body.sourceRefs)
      ? body.sourceRefs.slice(0, 50)
      : parseJson(row.source_refs_json, []),
    updatedAt: new Date().toISOString(),
  });
  return json({ document: mapTechnicalDocument(updated!) });
}
