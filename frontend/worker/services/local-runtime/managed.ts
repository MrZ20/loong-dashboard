import type { WorkerEnv } from "../../db";
import type { AITaskKey } from "../../domain/ai-task-catalog";
import { HttpError } from "../../http";
import { enqueueLocalAnalysisJob } from "../../repositories/local-runner";
import { ensurePersistedAITask, markAITaskRun, resolveAITask } from "../ai-task-settings";
import { requireAvailableRunner } from "./availability";
import { localExecutionPolicy, localTaskSelection } from "./helpers";
import { mapLocalJob } from "./mappers";

export async function enqueueManagedAITask(
  env: WorkerEnv,
  input: {
    userId: string;
    taskKey: AITaskKey;
    purpose: string;
    subjectKind: string;
    subjectKey: string;
    repoScope: string;
    targetRef?: string;
    baseSha?: string | null;
    headSha?: string | null;
    itemId?: string | null;
    chatThreadId?: string | null;
    priority?: number;
    request: Record<string, unknown>;
  },
) {
  const task = await resolveAITask(env, input.userId, input.taskKey);
  if (task.executionMode === "api") {
    throw new HttpError(409, `${task.definition.name} 当前不是本地 Agent 执行方式`);
  }
  const selection = localTaskSelection(task);
  const { settings } = await requireAvailableRunner(
    env, input.userId, selection.engine, "managed_ai_task", selection.permissionProfileId,
  );
  await ensurePersistedAITask(env, input.userId, task);
  const job = await enqueueLocalAnalysisJob(env, {
    id: crypto.randomUUID(),
    userId: input.userId,
    jobType: "managed_ai_task",
    engineId: selection.engine,
    subjectKind: input.subjectKind,
    subjectKey: input.subjectKey,
    repoScope: input.repoScope,
    itemId: input.itemId ?? null,
    chatThreadId: input.chatThreadId ?? null,
    sessionScope: `managed:${input.taskKey}:${input.subjectKey}:${Date.now()}`,
    baseSha: input.baseSha ?? null,
    headSha: input.headSha ?? null,
    targetRef: input.targetRef || input.headSha || "HEAD",
    providerId: selection.providerId,
    modelId: selection.modelId,
    priority: input.priority ?? 60,
    request: {
      ...localExecutionPolicy(selection),
      reasoningEffort: selection.reasoningEffort,
      aiTaskKey: input.taskKey,
      purpose: input.purpose,
      prompt: {
        type: task.definition.featureKey,
        version: task.prompt.promptVersion,
        templateId: task.prompt.templateId,
        templateName: task.prompt.name,
        revision: task.prompt.revision,
        systemContract: task.prompt.systemContract,
        instruction: task.prompt.instruction,
      },
      ...input.request,
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
      autoFetch: Boolean(settings?.auto_fetch),
    },
  });
  await markAITaskRun(env, input.userId, input.taskKey, "queued");
  return mapLocalJob(job!);
}
