import {
  REFRESH_TASK_TYPES,
  type RefreshRule,
  type RefreshTaskType,
} from "../../shared/contracts/refresh";

export {
  REFRESH_TASK_TYPES,
  type RefreshRule,
  type RefreshTaskType,
} from "../../shared/contracts/refresh";

export type RefreshTaskDefaults = {
  autoEnabled: boolean;
  intervalMinutes: number | null;
  activeRangeHours: number;
  refreshRule: RefreshRule;
  maxItems: number;
  includeCiChanges: boolean;
  includeCommentChanges: boolean;
};

export const REFRESH_DEFAULTS: Record<RefreshTaskType, RefreshTaskDefaults> = {
  facts: {
    autoEnabled: true,
    intervalMinutes: 60,
    activeRangeHours: 168,
    refreshRule: "updated_since_success",
    maxItems: 200,
    includeCiChanges: false,
    includeCommentChanges: false,
  },
  summary: {
    autoEnabled: true,
    intervalMinutes: 360,
    activeRangeHours: 168,
    refreshRule: "code_or_body",
    maxItems: 20,
    includeCiChanges: false,
    includeCommentChanges: false,
  },
  classification: {
    autoEnabled: true,
    intervalMinutes: null,
    activeRangeHours: 720,
    refreshRule: "first_only",
    maxItems: 500,
    includeCiChanges: false,
    includeCommentChanges: false,
  },
  deep_analysis: {
    autoEnabled: false,
    intervalMinutes: null,
    activeRangeHours: 720,
    refreshRule: "manual",
    maxItems: 1,
    includeCiChanges: false,
    includeCommentChanges: false,
  },
};

export function isRefreshTaskType(value: unknown): value is RefreshTaskType {
  return typeof value === "string" && REFRESH_TASK_TYPES.includes(value as RefreshTaskType);
}

export function includesRefreshBoundary(updatedAt: string, boundary: string | null) {
  return !boundary || updatedAt >= boundary;
}

export function isBeforeRefreshBoundary(updatedAt: string, boundary: string | null) {
  return Boolean(boundary && updatedAt < boundary);
}

export type SummaryChangeSet = {
  kind: "pr" | "issue";
  missing: boolean;
  titleChanged: boolean;
  bodyChanged: boolean;
  headChanged: boolean;
  filesChanged: boolean;
  updatedAtChanged: boolean;
  statusChanged: boolean;
  ciChanged: boolean;
  commentsChanged: boolean;
};

export function shouldMarkSummaryStale(
  changes: SummaryChangeSet,
  input: {
    refreshRule: RefreshRule;
    includeCiChanges: boolean;
    includeCommentChanges: boolean;
  },
) {
  if (changes.missing) return true;
  if (input.refreshRule === "manual") return false;
  if (changes.kind === "issue") {
    if (input.refreshRule === "any_update") return changes.updatedAtChanged;
    if (changes.titleChanged || changes.bodyChanged) return true;
    return input.includeCommentChanges && changes.commentsChanged;
  }
  if (input.refreshRule === "code_only") {
    return changes.headChanged || changes.filesChanged;
  }
  if (input.refreshRule === "any_update" && changes.updatedAtChanged) return true;
  if (changes.headChanged || changes.filesChanged || changes.bodyChanged) return true;
  if (input.includeCiChanges && changes.ciChanged) return true;
  if (input.includeCommentChanges && changes.commentsChanged) return true;
  return false;
}

export function shouldAutoClassify(
  refreshRule: RefreshRule,
  input: {
    missing: boolean;
    codeChanged: boolean;
    updatedAtChanged: boolean;
    locked: boolean;
  },
) {
  if (input.locked || refreshRule === "manual") return false;
  if (refreshRule === "first_only") return input.missing;
  if (refreshRule === "code_only") return input.missing || input.codeChanged;
  if (refreshRule === "any_update") return input.missing || input.updatedAtChanged;
  return input.missing;
}

export function summaryVersionKey(input: {
  kind: "pr" | "issue";
  headSha?: string | null;
  bodyHash: string;
  filesHash?: string;
}) {
  return input.kind === "pr"
    ? [input.headSha || "no-head", input.bodyHash, input.filesHash || "no-files"].join(":")
    : input.bodyHash;
}

export function shouldSkipSummaryJob(status: string | null | undefined) {
  return status === "queued" || status === "running" || status === "ready";
}

export function nextScheduledAt(
  completedAt: string,
  autoEnabled: boolean,
  intervalMinutes: number | null,
) {
  if (!autoEnabled || !intervalMinutes) return null;
  return new Date(new Date(completedAt).valueOf() + intervalMinutes * 60_000).toISOString();
}

export function refreshFailureState<T extends { watermarkUpdatedAt: string | null }>(
  state: T,
  attemptedAt: string,
  error: string,
) {
  return {
    ...state,
    status: "failed" as const,
    lastAttemptedAt: attemptedAt,
    lastError: error,
  };
}

export const MANUAL_TASK_EFFECTS: Record<RefreshTaskType, readonly string[]> = {
  facts: ["github_facts", "staleness_flags"],
  summary: ["summary", "summary_evidence"],
  classification: ["classification"],
  deep_analysis: ["deep_analysis_document"],
};
