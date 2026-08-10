import { parseJson } from "../../mappers/database-row";
import type { AIWorkspaceMode } from "../../../shared/contracts/ai";
import { aiTaskKeyForFeature, type AITaskKey } from "../../domain/ai-task-catalog";
import {
  isLocalAgentEngine,
  type LocalAgentEngine,
} from "../../domain/local-analysis";
import { HttpError } from "../../http";

export function nowIso() {
  return new Date().toISOString();
}

export function text(value: unknown, max = 20_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function texts(value: unknown, max = 100) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry, 2_000)).filter(Boolean).slice(0, max)
    : [];
}

export function parseJsonText(value: string) {
  return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

export function localTaskSelection(task: {
  executionMode: string;
  engineProviderId: string;
  engineModelId: string;
  reasoningEffort: string;
  workspaceMode: AIWorkspaceMode;
  updatePolicy: "none" | "fetch";
  permissionProfileId: "safe_readonly" | "community_research" | "worktree_development";
}) {
  if (!isLocalAgentEngine(task.executionMode)) {
    throw new HttpError(409, "当前任务未配置本地 Agent 执行引擎");
  }
  return {
    engine: task.executionMode,
    providerId: task.engineProviderId,
    modelId: task.engineModelId,
    reasoningEffort: task.reasoningEffort,
    workspaceMode: task.workspaceMode,
    updatePolicy: task.updatePolicy,
    permissionProfileId: task.permissionProfileId,
  } satisfies {
    engine: LocalAgentEngine;
    providerId: string;
    modelId: string;
    reasoningEffort: string;
    workspaceMode: AIWorkspaceMode;
    updatePolicy: "none" | "fetch";
    permissionProfileId: "safe_readonly" | "community_research" | "worktree_development";
  };
}

export function localExecutionPolicy(selection: ReturnType<typeof localTaskSelection>) {
  return {
    workspaceMode: selection.workspaceMode,
    updatePolicy: selection.updatePolicy,
    permissionProfileId: selection.permissionProfileId,
  };
}

export function resultAgentSessionId(result: Record<string, any>) {
  return text(result.agentSessionId, 200);
}

export function managedTaskKeyForLocalJob(job: Record<string, any>): AITaskKey | null {
  if (job.job_type === "managed_ai_task") {
    const request = parseJson<Record<string, any>>(job.request_json, {});
    return typeof request.aiTaskKey === "string" ? request.aiTaskKey as AITaskKey : null;
  }
  if (job.job_type === "deep_analysis") {
    return aiTaskKeyForFeature(
      job.subject_kind === "issue" ? "issue_deep_analysis" : "pr_deep_analysis",
      job.repo_scope,
    );
  }
  if (job.job_type === "repository_chat") return "repository_code_chat";
  if (job.job_type === "insight_evidence") return "local_code_insight";
  return null;
}
