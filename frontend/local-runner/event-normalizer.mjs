import { relative, resolve, sep } from "node:path";

function relativeCodePath(path, prepared) {
  if (typeof path !== "string") return null;
  for (const [repository, root] of Object.entries(prepared.worktrees || {})) {
    if (repository.includes(":")) continue;
    const value = relative(resolve(root), resolve(path));
    if (value && value !== ".." && !value.startsWith(`..${sep}`)) {
      return { repository, path: value };
    }
  }
  return null;
}

function toolInput(part) {
  return part?.state?.input || part?.input || {};
}

export function normalizeOpenCodeEvent(event, prepared) {
  const type = event?.type || "";
  const part = event?.properties?.part;
  // Session errors are finalized by runJob after it has distinguished a real
  // failure from a user-requested abort. Emitting here would show a red error
  // immediately before the normal "cancelled" event.
  if (type === "session.error") return null;
  if (type !== "message.part.updated" || part?.type !== "tool") return null;
  const tool = String(part.tool || part.name || "").toLowerCase();
  const input = toolInput(part);
  if (tool === "read") {
    const location = relativeCodePath(input.filePath || input.path || input.filename, prepared);
    if (!location) return null;
    return {
      eventType: "file_read",
      source: "opencode",
      level: "info",
      message: `[Read] ${location.repository}/${location.path}`,
      metadata: { ...location, tool: "read" },
    };
  }
  if (["grep", "glob", "lsp"].includes(tool)) {
    const query = String(input.pattern || input.query || input.symbol || input.operation || "代码符号").slice(0, 300);
    return {
      eventType: "symbol_search",
      source: "opencode",
      level: "info",
      message: `[Search] ${query}`,
      metadata: { tool, query },
    };
  }
  return null;
}

export function normalizeCodexEvent(event, prepared) {
  if (event?.method !== "item/completed") return null;
  const item = event?.params?.item;
  if (item?.type === "fileChange") {
    return {
      eventType: "warning",
      source: "codex",
      level: "warning",
      message: "[Codex] 只读任务产生了文件修改事件，结果将被拒绝",
      metadata: {},
    };
  }
  if (item?.type !== "commandExecution") return null;
  const command = String(item.command || "").slice(0, 500);
  const location = relativeCodePath(item.cwd, prepared);
  const isGit = /(^|\s)git\s+(status|log|show|diff|grep|rev-parse|merge-base|branch)(\s|$)/.test(command);
  const isSearch = /(^|\s)(rg|grep|sed|head|tail)(\s|$)/.test(command);
  if (!isGit && !isSearch) return null;
  return {
    eventType: isGit ? "git_query" : "symbol_search",
    source: "codex",
    level: item.status === "failed" ? "warning" : "info",
    message: `${isGit ? "[Git]" : "[Search]"} ${command}`,
    metadata: {
      tool: isGit ? "git" : "search",
      repository: location?.repository,
      query: command,
      durationMs: item.durationMs ?? undefined,
      sourceEvidence: isSearch,
    },
  };
}

export class JobEventStream {
  constructor(api, jobId) {
    this.api = api;
    this.jobId = jobId;
    this.sequence = 0;
    this.sourceRead = false;
    this.seenToolEvents = new Set();
  }

  async emit(eventType, source, message, metadata = {}, level = "info") {
    if (eventType === "file_read" || metadata?.sourceEvidence === true) this.sourceRead = true;
    this.sequence += 1;
    await this.api.events(this.jobId, [{
      sequence: this.sequence,
      eventType,
      source,
      level,
      message,
      metadata,
      createdAt: new Date().toISOString(),
    }]);
  }

  async engine(adapter, event, prepared) {
    const normalized = adapter.normalizeEvent(event, prepared);
    if (!normalized) return;
    const key = `${normalized.eventType}:${normalized.message}`;
    if (this.seenToolEvents.has(key)) return;
    this.seenToolEvents.add(key);
    await this.emit(normalized.eventType, normalized.source, normalized.message, normalized.metadata, normalized.level);
  }

}
