import type {
  AnalysisDocument,
  AuthUser,
  ChatMessage,
  CommunityItem,
  DomainMapApi,
  RepositoryMeta,
  TechnicalDocument,
} from "../types";

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error || `请求失败（${response.status}）`,
      payload?.details,
    );
  }
  return payload as T;
}

function relativeTime(value: string) {
  const timestamp = new Date(value).valueOf();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.round(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} 小时前`;
  return `${Math.round(seconds / 86_400)} 天前`;
}

function mapCommunityItem(item: any): CommunityItem {
  return {
    id: Number(item.number),
    repo: item.repo,
    kind: item.kind,
    state: item.state,
    title: item.title,
    author: item.author,
    time: relativeTime(item.updatedAt),
    statusText: item.statusText,
    domain: item.domain,
    summary: item.aiSummary,
    body: item.bodyMd,
    bodyMd: item.bodyMd,
    htmlUrl: item.htmlUrl,
    comments: Number(item.comments ?? 0),
    important: Boolean(item.important),
    diff: item.diff ?? undefined,
    deepAnalysis: {
      overview: "",
      impact: "",
      risks: [],
      suggestions: [],
    },
  };
}

export const api = {
  health: () =>
    apiFetch<{
      ok: boolean;
      database: boolean;
      aiConfigured: boolean;
      githubConfigured: boolean;
      timestamp: string;
    }>("/api/health"),

  authProviders: () =>
    apiFetch<{
      mode: "development" | "chatgpt";
      signInPath: string;
      signOutPath: string;
    }>("/api/auth/providers"),

  me: () => apiFetch<{ user: AuthUser }>("/api/auth/me"),

  devLogin: (email: string, displayName: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({ email, displayName }),
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  repositories: async () => {
    const result = await apiFetch<{ repositories: any[] }>("/api/repositories");
    return result.repositories.map(
      (repo): RepositoryMeta => ({
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        description:
          repo.id === "vllm"
            ? "高吞吐大模型推理与服务引擎"
            : "vLLM 的 Ascend NPU 设备插件",
        stars: "",
        openPulls: Number(repo.openPulls ?? 0),
        openIssues: Number(repo.openIssues ?? 0),
        lastSyncedAt: repo.lastSyncedAt,
        syncStatus: repo.syncStatus,
      }),
    );
  },

  syncRepository: (repo: string) =>
    apiFetch<{ run: unknown }>(`/api/repositories/${encodeURIComponent(repo)}/sync`, {
      method: "POST",
    }),

  community: async (params: Record<string, string | number | undefined> = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const result = await apiFetch<{ items: any[]; total: number }>(
      `/api/community${search.size ? `?${search}` : ""}`,
    );
    return result.items.map(mapCommunityItem);
  },

  communityItem: async (
    repo: string,
    kind: "pr" | "issue",
    number: number,
    refreshDiff = false,
  ) => {
    const suffix = refreshDiff ? "?refresh_diff=1" : "";
    const result = await apiFetch<{ item: any; analyses: AnalysisDocument[] }>(
      `/api/community/${encodeURIComponent(repo)}/${kind}/${number}${suffix}`,
    );
    return {
      item: mapCommunityItem(result.item),
      analyses: result.analyses,
    };
  },

  analyzeCommunityItem: (
    repo: string,
    kind: "pr" | "issue",
    number: number,
    prompt = "",
  ) =>
    apiFetch<{ analysis: AnalysisDocument; provider: string }>(
      `/api/community/${encodeURIComponent(repo)}/${kind}/${number}/analyze`,
      { method: "POST", body: JSON.stringify({ prompt }) },
    ),

  watchlist: async () => {
    const result = await apiFetch<{ items: any[] }>("/api/watchlist");
    return result.items.map((item) => ({
      item: mapCommunityItem(item),
      watch: item.watch,
    }));
  },

  addWatch: (itemId: string, meta: Record<string, unknown> = {}) =>
    apiFetch<{ ok: boolean }>(`/api/watchlist/${encodeURIComponent(itemId)}`, {
      method: "POST",
      body: JSON.stringify(meta),
    }),

  removeWatch: (itemId: string) =>
    apiFetch<void>(`/api/watchlist/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    }),

  analyses: async (type?: string, scope?: string) => {
    const search = new URLSearchParams();
    if (type) search.set("type", type);
    if (scope) search.set("scope", scope);
    const result = await apiFetch<{ analyses: AnalysisDocument[] }>(
      `/api/analyses${search.size ? `?${search}` : ""}`,
    );
    return result.analyses;
  },

  analysis: async (id: string) => {
    const result = await apiFetch<{ analysis: AnalysisDocument }>(
      `/api/analyses/${encodeURIComponent(id)}`,
    );
    return result.analysis;
  },

  generateAnalysis: (
    input: {
      type: string;
      scope: string;
      prompt: string;
      title?: string;
    },
  ) =>
    apiFetch<{ analysis: AnalysisDocument; provider: string }>(
      "/api/analyses/generate",
      { method: "POST", body: JSON.stringify(input) },
    ),

  domains: async () => {
    const result = await apiFetch<{ domains: DomainMapApi[] }>("/api/domains");
    return result.domains;
  },

  createDomainSnapshot: (domain: string) =>
    apiFetch<{ snapshot: unknown }>(
      `/api/domains/${encodeURIComponent(domain)}/snapshot`,
      { method: "POST" },
    ),

  documents: async (category?: string) => {
    const search = category
      ? `?category=${encodeURIComponent(category)}`
      : "";
    const result = await apiFetch<{ documents: TechnicalDocument[] }>(
      `/api/documents${search}`,
    );
    return result.documents;
  },

  saveDocument: (
    input: Partial<TechnicalDocument> &
      Pick<TechnicalDocument, "title" | "category" | "contentMd">,
  ) =>
    apiFetch<{ document: TechnicalDocument }>("/api/documents", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateDocument: (id: string, input: Partial<TechnicalDocument>) =>
    apiFetch<{ document: TechnicalDocument }>(
      `/api/documents/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),

  createThread: (title = "新对话", context: Record<string, unknown> = {}) =>
    apiFetch<{ thread: { id: string; title: string } }>("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ title, context }),
    }),

  threads: () =>
    apiFetch<{ threads: Array<{ id: string; title: string; updatedAt: string }> }>(
      "/api/chat/threads",
    ),

  messages: (threadId: string) =>
    apiFetch<{ messages: ChatMessage[] }>(
      `/api/chat/threads/${encodeURIComponent(threadId)}/messages`,
    ),

  sendMessage: (
    threadId: string,
    input: { content: string; pageContext: string; selection: string },
  ) =>
    apiFetch<{
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
      provider: string;
    }>(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
