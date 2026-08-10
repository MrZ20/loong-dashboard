import type { WorkerEnv } from "../../db";
import { runnerIsOnline, type LocalJobType } from "../../domain/local-analysis";
import { HttpError } from "../../http";
import { enqueueLocalAnalysisJob, ensureLocalRunnerSettings, latestLocalRunner } from "../../repositories/local-runner";
import { mapLocalJob } from "./mappers";

export async function enqueueRunnerAction(
  env: WorkerEnv,
  input: {
    userId: string;
    jobType: Extract<LocalJobType,
      "runner_check" | "repository_check" | "repository_clone" | "provider_refresh" | "worktree_cleanup">;
    repoScope?: string;
  },
) {
  const settings = await ensureLocalRunnerSettings(env, input.userId);
  const runner = await latestLocalRunner(env);
  if (!runner || !runnerIsOnline(runner.last_seen_at)) {
    throw new HttpError(503, "本地 Runner 离线，无法执行该操作");
  }
  const job = await enqueueLocalAnalysisJob(env, {
    id: crypto.randomUUID(),
    userId: input.userId,
    jobType: input.jobType,
    engineId: "",
    subjectKind: "runner",
    subjectKey: input.repoScope || "all",
    repoScope: input.repoScope || "all",
    sessionScope: `runner:${input.jobType}:${Date.now()}`,
    request: {
      repository: input.repoScope || "all",
      worktreeRetentionHours: Number(settings?.worktree_retention_hours ?? 24),
    },
    priority: 110,
  });
  return mapLocalJob(job!);
}
