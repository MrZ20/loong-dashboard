import type { WorkerEnv } from "../../db";
import { parseJson } from "../../mappers/database-row";
import { HttpError } from "../../http";
import { createMessageRow, findThreadRow } from "../../repositories/chat";
import { enqueueLocalAnalysisJob, latestSessionBinding, updateThreadLocalAnalysisState } from "../../repositories/local-runner";
import { ensurePersistedAITask, markAITaskRun, resolveAITask } from "../ai-task-settings";
import { requireAvailableRunner } from "./availability";
import { localExecutionPolicy, localTaskSelection, nowIso } from "./helpers";
import { mapLocalJob, rowAgentSessionId, sameChatCodeContext } from "./mappers";

export async function enqueueRepositoryChat(
  env: WorkerEnv,
  input: {
    userId: string;
    threadId: string;
    content: string;
    repoScope: string;
    targetRef: string;
    providerId: string;
    modelId: string;
    pageContext: string;
    selection: string;
    taskKey?: "chat_assistant" | "repository_code_chat";
  },
) {
  const task = await resolveAITask(
    env,
    input.userId,
    input.taskKey || "repository_code_chat",
  );
  if (task.executionMode === "api") {
    throw new HttpError(409, `${task.definition.name} 必须选择本地 Agent 执行方式`);
  }
  const selection = localTaskSelection(task);
  const { settings } = await requireAvailableRunner(
    env, input.userId, selection.engine, "repository_chat", selection.permissionProfileId,
  );
  await ensurePersistedAITask(env, input.userId, task);
  const prompt = task.prompt;
  const thread = await findThreadRow(env, input.threadId, input.userId);
  if (!thread) throw new HttpError(404, "对话不存在");
  const sessionScope = `chat:${input.threadId}`;
  const binding = await latestSessionBinding(env, input.userId, sessionScope, selection.engine);
  const requestedRef = input.targetRef || "HEAD";
  const sameCodeContext = sameChatCodeContext(thread, input.repoScope, requestedRef);
  const jobId = crypto.randomUUID();
  const userMessageId = crypto.randomUUID();
  const createdAt = nowIso();
  await createMessageRow(env, {
    id: userMessageId,
    threadId: input.threadId,
    role: "user",
    contentMd: input.content,
    context: {
      mode: "repository",
      repoScope: input.repoScope,
      targetRef: input.targetRef,
      pageContext: input.pageContext,
      selection: input.selection,
    },
    createdAt,
  });
  const job = await enqueueLocalAnalysisJob(env, {
    id: jobId,
    userId: input.userId,
    jobType: "repository_chat",
    engineId: selection.engine,
    subjectKind: "chat",
    subjectKey: input.threadId,
    repoScope: input.repoScope,
    chatThreadId: input.threadId,
    sessionScope,
    targetRef: requestedRef,
    providerId: selection.providerId,
    modelId: selection.modelId,
    agentSessionId: sameCodeContext
      ? rowAgentSessionId(binding) ?? thread.agent_session_id ?? null
      : null,
    priority: 80,
    request: {
      ...localExecutionPolicy(selection),
      reasoningEffort: selection.reasoningEffort,
      prompt: {
        type: "repository-code-chat",
        version: prompt.promptVersion,
        templateId: prompt.templateId,
        templateName: prompt.name,
        revision: prompt.revision,
        systemContract: prompt.systemContract,
        instruction: prompt.instruction,
      },
      question: input.content,
      pageContext: input.pageContext,
      selection: input.selection,
      repoScope: input.repoScope,
      targetRef: requestedRef,
      previousMemory: binding
        ? {
            summaryMd: binding.summary_md,
            confirmedFacts: parseJson(binding.confirmed_facts_json, []),
            unresolved: parseJson(binding.unresolved_json, []),
            focus: parseJson(binding.focus_json, []),
          }
        : null,
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
      autoFetch: Boolean(settings?.auto_fetch),
    },
  });
  await updateThreadLocalAnalysisState(env, {
    threadId: input.threadId,
    mode: "repository",
    repoScope: input.repoScope,
    targetRef: requestedRef,
    providerId: selection.providerId,
    modelId: selection.modelId,
    runnerJobId: jobId,
  });
  await markAITaskRun(env, input.userId, task.key, "queued");
  return {
    job: mapLocalJob(job!),
    userMessage: {
      id: userMessageId,
      role: "user",
      contentMd: input.content,
      context: { mode: "repository" },
      createdAt,
    },
  };
}
