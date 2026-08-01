import { answerChat } from "../ai";
import { requireUser } from "../auth";
import {
  parseJson,
  type WorkerEnv,
} from "../db";
import {
  cleanText,
  HttpError,
  json,
  noContent,
  readJson,
  requireMethod,
} from "../http";
import {
  createMessageRow,
  createThreadRow,
  deleteThreadRows,
  findThreadRow,
  listConversationRows,
  listMessageRows,
  listThreadRows,
  renameThreadRow,
  touchThreadRow,
} from "../repositories/chat";

function pathMatch(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export async function handleChat(request: Request, env: WorkerEnv, path: string) {
  const user = await requireUser(request, env);
  if (path === "/api/chat/threads") {
    if (request.method === "GET") {
      const rows = await listThreadRows(env, user.id);
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
    await createThreadRow(env, {
      id,
      userId: user.id,
      title: cleanText(body.title, 120) || "新对话",
      context: body.context ?? {},
      createdAt: now,
    });
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
    const thread = await findThreadRow(env, threadId, user.id);
    if (!thread) throw new HttpError(404, "对话不存在");
    if (request.method === "DELETE") {
      await deleteThreadRows(env, threadId, user.id);
      return noContent();
    }
    requireMethod(request, ["PUT"]);
    const body = await readJson<{ title?: string }>(request);
    const title = cleanText(body.title, 120);
    if (!title) throw new HttpError(400, "对话标题不能为空");
    const updatedAt = new Date().toISOString();
    await renameThreadRow(env, threadId, user.id, title, updatedAt);
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
  const thread = await findThreadRow(env, threadId, user.id);
  if (!thread) throw new HttpError(404, "对话不存在");

  if (request.method === "GET") {
    const rows = await listMessageRows(env, threadId);
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
  await createMessageRow(env, {
    id: userMessageId,
    threadId,
    role: "user",
    contentMd: content,
    context,
    createdAt: now,
  });
  const historyRows = await listConversationRows(env, threadId);
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
  await createMessageRow(env, {
    id: assistantId,
    threadId,
    role: "assistant",
    contentMd: result.content,
    context: {
      model: result.model,
      provider: result.provider,
      providerName: result.providerName,
    },
    createdAt: assistantAt,
  });
  await touchThreadRow(env, threadId, content.slice(0, 50), assistantAt);
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

