import type {
  AnalysisDocument,
  AIProviderConfig,
  AuthUser,
  ChatMessage,
  ChatThread,
  CommunityItem,
  CrossRepoImpact,
  DomainMapApi,
  RepositoryMeta,
  TechnicalDocument,
  TodaySummary,
  UserAccount,
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
    updatedAt: item.updatedAt,
    statusText: item.statusText,
    domain: item.domain,
    summary: item.aiSummary,
    summarySource: item.summarySource === "ai" ? "ai" : "excerpt",
    summaryUpdatedAt: item.summaryUpdatedAt ?? null,
    body: item.bodyMd,
    bodyMd: item.bodyMd,
    htmlUrl: item.htmlUrl,
    comments: Number(item.comments ?? 0),
    important: Boolean(item.important),
    lastEventType: item.lastEventType ?? null,
    lastEventAt: item.lastEventAt ?? null,
    domainAssessment: item.domainAssessment ?? {
      domain: item.domain,
      source: "text",
      confidence: 0,
      confidenceLabel: "low",
      matchedPaths: [],
      matchedTerms: [],
      scores: [],
    },
    reviewSignal: item.reviewSignal ?? null,
    reviewSignalUpdatedAt: item.reviewSignalUpdatedAt ?? null,
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

  devLogin: (email: string, displayName: string, password: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({ email, displayName, password }),
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
            : repo.id === "vllm-ascend"
              ? "vLLM 的 Ascend NPU 设备插件"
              : `${repo.owner}/${repo.name}`,
        stars: "",
        openPulls: Number(repo.openPulls ?? 0),
        openIssues: Number(repo.openIssues ?? 0),
        lastSyncedAt: repo.lastSyncedAt,
        syncStatus: repo.syncStatus,
      }),
    );
  },

  syncRepository: (repo: string) =>
    apiFetch<{
      run: {
        pulls: number;
        issues: number;
        capturedEvents: number;
        analyzed: number;
        warning?: string;
        finishedAt: string;
      };
    }>(`/api/repositories/${encodeURIComponent(repo)}/sync`, {
      method: "POST",
    }),

  today: async (repo: string) => {
    const result = await apiFetch<{ summary: TodaySummary }>(
      `/api/today?repo=${encodeURIComponent(repo)}`,
    );
    return result.summary;
  },

  impacts: async () => {
    const result = await apiFetch<{ impacts: CrossRepoImpact[] }>("/api/impacts");
    return result.impacts;
  },

  updateImpactStatus: (id: string, status: string) =>
    apiFetch<{ ok: boolean }>(`/api/impacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
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
  ) => {
    const result = await apiFetch<{ item: any; analyses: AnalysisDocument[] }>(
      `/api/community/${encodeURIComponent(repo)}/${kind}/${number}`,
    );
    return {
      item: mapCommunityItem(result.item),
      analyses: result.analyses,
    };
  },

  communityDiffFiles: async (
    repo: string,
    number: number,
  ) => {
    const result = await apiFetch<{
      entries: Array<{
        path: string;
        additions: number;
        deletions: number;
        patch: string;
      }>;
      skippedLarge: number;
    }>(
      `/api/community/${encodeURIComponent(repo)}/pr/${number}/diff-files`,
    );
    return result;
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
    apiFetch<{ thread: ChatThread }>("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ title, context }),
    }),

  threads: () =>
    apiFetch<{ threads: ChatThread[] }>("/api/chat/threads"),

  renameThread: (threadId: string, title: string) =>
    apiFetch<{ thread: ChatThread }>(
      `/api/chat/threads/${encodeURIComponent(threadId)}`,
      { method: "PUT", body: JSON.stringify({ title }) },
    ),

  deleteThread: (threadId: string) =>
    apiFetch<void>(`/api/chat/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    }),

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

  profile: () =>
    apiFetch<{ profile: UserAccount; mode: AuthUser["mode"] }>(
      "/api/settings/profile",
    ),

  updateProfile: (input: {
    displayName: string;
    role: string;
    organization: string;
    bio: string;
  }) =>
    apiFetch<{ profile: UserAccount }>("/api/settings/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  accounts: () =>
    apiFetch<{ accounts: UserAccount[]; canAdd: boolean }>(
      "/api/settings/accounts",
    ),

  createAccount: (input: {
    email: string;
    displayName: string;
    role?: string;
    organization?: string;
  }) =>
    apiFetch<{ account: UserAccount }>("/api/settings/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  switchAccount: (accountId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/settings/accounts/${encodeURIComponent(accountId)}/switch`,
      { method: "POST" },
    ),

  aiProviders: () =>
    apiFetch<{ providers: AIProviderConfig[] }>(
      "/api/settings/ai-providers",
    ),

  saveAIProvider: (
    input: {
      name: string;
      baseUrl: string;
      apiMode: AIProviderConfig["apiMode"];
      model: string;
      token?: string;
      makeActive?: boolean;
    },
    id?: string,
  ) =>
    apiFetch<{ provider: AIProviderConfig }>(
      id
        ? `/api/settings/ai-providers/${encodeURIComponent(id)}`
        : "/api/settings/ai-providers",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(input),
      },
    ),

  activateAIProvider: (id: string) =>
    apiFetch<{ ok: boolean; activeProviderId: string }>(
      `/api/settings/ai-providers/${encodeURIComponent(id)}/activate`,
      { method: "POST" },
    ),

  deleteAIProvider: (id: string) =>
    apiFetch<void>(
      `/api/settings/ai-providers/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};
