import type { WorkerEnv } from "../../db";
import { HttpError } from "../../http";
import { enqueueLocalAnalysisJob } from "../../repositories/local-runner";
import { ensurePersistedAITask, markAITaskRun, resolveAITask } from "../ai-task-settings";
import { requireAvailableRunner } from "./availability";
import { localExecutionPolicy, localTaskSelection } from "./helpers";
import { mapLocalJob } from "./mappers";

export async function enqueueInsightLocalEvidence(
  env: WorkerEnv,
  input: {
    userId: string;
    scope: string;
    title: string;
    targets: unknown[];
    providerId?: string;
    modelId?: string;
  },
) {
  const task = await resolveAITask(env, input.userId, "local_code_insight");
  if (task.executionMode === "api") {
    throw new HttpError(409, "本地代码证据洞察必须选择本地 Agent 执行方式");
  }
  const selection = localTaskSelection(task);
  const { settings } = await requireAvailableRunner(
    env, input.userId, selection.engine, "insight_evidence", selection.permissionProfileId,
  );
  await ensurePersistedAITask(env, input.userId, task);
  const prompt = task.prompt;
  if (!input.targets.length) {
    throw new HttpError(400, "使用本地代码证据时至少选择一个社区事项或领域");
  }
  const job = await enqueueLocalAnalysisJob(env, {
    id: crypto.randomUUID(),
    userId: input.userId,
    jobType: "insight_evidence",
    engineId: selection.engine,
    subjectKind: "insight",
    subjectKey: input.scope,
    repoScope: input.scope,
    sessionScope: `insight:${input.scope}:${Date.now()}`,
    targetRef: "HEAD",
    providerId: selection.providerId,
    modelId: selection.modelId,
    priority: 70,
    request: {
      ...localExecutionPolicy(selection),
      reasoningEffort: selection.reasoningEffort,
      prompt: {
        type: "local-code-insight",
        version: prompt.promptVersion,
        templateId: prompt.templateId,
        templateName: prompt.name,
        revision: prompt.revision,
        systemContract: prompt.systemContract,
        instruction: prompt.instruction,
      },
      title: input.title,
      scope: input.scope,
      targets: input.targets.slice(0, 20),
      timeoutSeconds: Number(settings?.timeout_seconds ?? 900),
      autoFetch: Boolean(settings?.auto_fetch),
    },
  });
  await markAITaskRun(env, input.userId, task.key, "queued");
  return mapLocalJob(job!);
}
