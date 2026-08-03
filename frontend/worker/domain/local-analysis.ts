export const LOCAL_JOB_TYPES = [
  "deep_analysis",
  "insight_evidence",
  "repository_chat",
  "managed_ai_task",
  "runner_check",
  "repository_check",
  "repository_clone",
  "provider_refresh",
  "worktree_cleanup",
] as const;

export type LocalJobType = (typeof LOCAL_JOB_TYPES)[number];

export const LOCAL_JOB_STATUSES = [
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;

export type LocalJobStatus = (typeof LOCAL_JOB_STATUSES)[number];

export const LOCAL_EVENT_TYPES = [
  "task_started",
  "repository_prepare",
  "git_fetch",
  "worktree_create",
  "file_read",
  "symbol_search",
  "git_query",
  "model_call",
  "report_generate",
  "task_completed",
  "warning",
  "error",
] as const;

export type LocalEventType = (typeof LOCAL_EVENT_TYPES)[number];

export type CodeReference = {
  repository: "vllm" | "vllm-ascend";
  commitSha: string;
  path: string;
  symbol: string;
  startLine: number | null;
  endLine: number | null;
  reason: string;
};

export const READ_ONLY_OPENCODE_PERMISSIONS = [
  { permission: "*", pattern: "*", action: "deny" },
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "grep", pattern: "*", action: "allow" },
  { permission: "glob", pattern: "*", action: "allow" },
  { permission: "lsp", pattern: "*", action: "allow" },
  { permission: "read", pattern: "**/.env*", action: "deny" },
  { permission: "external_directory", pattern: "*", action: "deny" },
] as const;

export const READ_ONLY_OPENCODE_TOOLS: Record<string, boolean> = {
  read: true,
  grep: true,
  glob: true,
  lsp: true,
  edit: false,
  write: false,
  apply_patch: false,
  patch: false,
  bash: false,
  shell: false,
  webfetch: false,
  websearch: false,
  task: false,
};

export function isLocalJobType(value: unknown): value is LocalJobType {
  return typeof value === "string" && LOCAL_JOB_TYPES.includes(value as LocalJobType);
}

export function isTerminalLocalJobStatus(status: string) {
  return ["completed", "failed", "cancelled"].includes(status);
}

export function runnerIsOnline(lastSeenAt: string | null, now = Date.now()) {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).valueOf();
  return Number.isFinite(seen) && now - seen < 45_000;
}

function safeText(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeCodeReferences(
  value: unknown,
  allowed: Record<string, string>,
): CodeReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: any) => {
    const repository = entry?.repository === "vllm" || entry?.repository === "vllm-ascend"
      ? entry.repository
      : null;
    const expectedCommit = repository ? allowed[repository] : "";
    const commitSha = safeText(entry?.commitSha, 80);
    const path = safeText(entry?.path, 1_000).replace(/^\/+/, "");
    if (
      !repository ||
      !expectedCommit ||
      commitSha !== expectedCommit ||
      !path ||
      path.includes("..") ||
      path.startsWith(".env") ||
      path.includes("/.env")
    ) return [];
    const startLine = Number.isInteger(entry?.startLine) && entry.startLine > 0
      ? entry.startLine
      : null;
    const endLine = Number.isInteger(entry?.endLine) && entry.endLine >= (startLine || 1)
      ? entry.endLine
      : startLine;
    return [{
      repository,
      commitSha,
      path,
      symbol: safeText(entry?.symbol, 500) || "未指定符号",
      startLine,
      endLine,
      reason: safeText(entry?.reason, 1_000),
    }];
  }).slice(0, 200);
}

export function publicRunnerState(row: Record<string, any> | null, now = Date.now()) {
  const online = runnerIsOnline(row?.last_seen_at ?? null, now);
  const repositories = row?.repositories_json
    ? JSON.parse(row.repositories_json)
    : {};
  return {
    id: row?.id || null,
    online,
    status: online ? row?.status || "online" : "offline",
    version: row?.version || "",
    opencodeVersion: row?.opencode_version || "",
    authConfigured: Boolean(row?.auth_configured),
    readonlyVerified: Boolean(row?.readonly_verified),
    repositories,
    providers: row?.providers_json ? JSON.parse(row.providers_json) : [],
    capabilities: row?.capabilities_json ? JSON.parse(row.capabilities_json) : {},
    activeJobs: Number(row?.active_jobs ?? 0),
    lastSeenAt: row?.last_seen_at ?? null,
    lastError: row?.last_error ?? null,
  };
}

export function eventLabel(input: {
  type: string;
  tool?: string;
  path?: string;
  query?: string;
  message?: string;
}) {
  const message = safeText(input.message, 500);
  if (message) return message;
  if (input.type === "file_read") return `[Read] ${safeText(input.path, 500)}`;
  if (input.type === "symbol_search") return `[Search] ${safeText(input.query, 500)}`;
  if (input.type === "git_query") return `[Git] ${safeText(input.query, 500)}`;
  if (input.type === "model_call") return "[Agent] 正在分析本地代码证据";
  if (input.type === "report_generate") return "[Agent] 正在整理最终报告";
  return "任务状态已更新";
}
