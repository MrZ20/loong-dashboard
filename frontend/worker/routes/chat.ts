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
import { updateThreadLocalAnalysisState } from "../repositories/local-runner";
import { enqueueRepositoryChat } from "../services/local-analysis";
import { resolveAITask } from "../services/ai-task-settings";

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
          mode: row.mode || "normal",
          repoScope: row.repo_scope || "",
          targetRef: row.target_ref || "",
          providerId: row.provider_id || "",
          modelId: row.model_id || "",
          opencodeSessionId: row.opencode_session_id ?? null,
          opencodeCommitSha: row.opencode_commit_sha || "",
          runnerJobId: row.runner_job_id ?? null,
          localEvidence: Boolean(row.local_evidence),
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
    mode?: string;
    repoScope?: string;
    targetRef?: string;
    providerId?: string;
    modelId?: string;
  }>(request);
  const content = cleanText(body.content, 20_000);
  if (!content) throw new HttpError(400, "问题不能为空");
  const now = new Date().toISOString();
  const userMessageId = crypto.randomUUID();
  const context = {
    pageContext: cleanText(body.pageContext, 20_000),
    selection: cleanText(body.selection, 8_000),
  };
  if (body.mode === "repository") {
    const repoScope = cleanText(body.repoScope, 40);
    if (!["vllm", "vllm-ascend", "both", "current"].includes(repoScope)) {
      throw new HttpError(400, "仓库分析模式需要选择代码范围");
    }
    const repositoryTask = await resolveAITask(env, user.id, "repository_code_chat");
    if (repositoryTask.executionMode === "opencode") {
      const result = await enqueueRepositoryChat(env, {
        userId: user.id,
        threadId,
        content,
        repoScope,
        targetRef: cleanText(body.targetRef, 200) || "HEAD",
        providerId: "",
        modelId: "",
        pageContext: context.pageContext,
        selection: context.selection,
      });
      return json(result, { status: 202 });
    }
    await createMessageRow(env, {
      id: userMessageId,
      threadId,
      role: "user",
      contentMd: content,
      context: { ...context, mode: "repository", repoScope, localEvidence: false },
      createdAt: now,
    });
    const historyRows = await listConversationRows(env, threadId);
    const result = await answerChat(env, {
      userId: user.id,
      messages: historyRows.map((row) => ({ role: row.role, content: row.content_md })),
      pageContext: `${context.pageContext}\n\n仓库范围：${repoScope}\n目标版本：${cleanText(body.targetRef, 200) || "HEAD"}\n注意：当前任务使用直连 API，没有读取本地源码，不得声称已完成代码检索。`,
      selection: context.selection,
      taskKey: "repository_code_chat",
    });
    const assistantId = crypto.randomUUID();
    const assistantAt = new Date().toISOString();
    await createMessageRow(env, {
      id: assistantId,
      threadId,
      role: "assistant",
      contentMd: result.content,
      context: {
        mode: "repository",
        localEvidence: false,
        model: result.model,
        provider: result.providerName,
        promptTemplateId: result.prompt.templateId,
      },
      createdAt: assistantAt,
    });
    await touchThreadRow(env, threadId, content.slice(0, 50), assistantAt);
    await updateThreadLocalAnalysisState(env, {
      threadId,
      mode: "repository",
      repoScope,
      targetRef: cleanText(body.targetRef, 200) || "HEAD",
      providerId: result.providerName,
      modelId: result.model,
      runnerJobId: null,
      localEvidence: false,
    });
    return json({
      userMessage: { id: userMessageId, role: "user", contentMd: content, createdAt: now },
      assistantMessage: { id: assistantId, role: "assistant", contentMd: result.content, createdAt: assistantAt },
      provider: result.provider,
      providerName: result.providerName,
    }, { status: 201 });
  }
  const normalTask = await resolveAITask(env, user.id, "chat_assistant");
  if (normalTask.executionMode === "opencode") {
    const repoScope = ["vllm", "vllm-ascend", "both", "current"].includes(body.repoScope || "")
      ? String(body.repoScope)
      : "both";
    const result = await enqueueRepositoryChat(env, {
      userId: user.id,
      threadId,
      content,
      repoScope,
      targetRef: cleanText(body.targetRef, 200) || "HEAD",
      providerId: "",
      modelId: "",
      pageContext: context.pageContext,
      selection: context.selection,
      taskKey: "chat_assistant",
    });
    return json({ ...result, effectiveMode: "repository" }, { status: 202 });
  }
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
      promptTemplateId: result.prompt.templateId,
      promptTemplateName: result.prompt.name,
      promptRevision: result.prompt.revision,
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
