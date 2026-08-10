import type { AnalysisDocument, LocalAnalysisJob } from "../types/analysis";
import type {
  CommunityItem,
  CrossRepoImpact,
  RepositoryMeta,
  TodaySummary,
  WatchlistMeta,
} from "../types/community";
import type { RefreshTaskState, RefreshTaskType } from "../types/refresh";
import { apiFetch } from "./core";
import { mapCommunityItem } from "./mappers";

export interface CommunityPageQuery {
  repo?: string;
  kind?: "pr" | "issue";
  domain?: string;
  state?: "open" | "draft" | "merged" | "closed" | "reopened";
  q?: string;
  from?: string;
  to?: string;
  sort?: "updated" | "number";
  limit?: number;
  offset?: number;
}

export interface CommunityPage {
  items: CommunityItem[];
  total: number;
  limit: number;
  offset: number;
  domains: string[];
  domainOptions: Array<{
    value: string;
    label: string;
    description: string;
  }>;
}

async function fetchCommunityPage(
  params: CommunityPageQuery = {},
): Promise<CommunityPage> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const result = await apiFetch<{
    items: any[];
    total: number;
    limit: number;
    offset: number;
    domains?: string[];
    domainOptions?: CommunityPage["domainOptions"];
  }>(
    `/api/community${search.size ? `?${search}` : ""}`,
  );
  return {
    items: result.items.map(mapCommunityItem),
    total: Number(result.total ?? 0),
    limit: Number(result.limit ?? params.limit ?? 100),
    offset: Number(result.offset ?? params.offset ?? 0),
    domains: Array.isArray(result.domains) ? result.domains : [],
    domainOptions: Array.isArray(result.domainOptions)
      ? result.domainOptions
      : (result.domains ?? []).map((domain) => ({
          value: domain,
          label: domain,
          description: "该领域来自当前仓库已同步的分类结果。",
        })),
  };
}

export const communityApi = {
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
        refreshTasks: (repo.refreshTasks ?? []) as RefreshTaskState[],
      }),
    );
  },

  refreshRepositoryTask: (
    repo: string,
    taskType: Exclude<RefreshTaskType, "deep_analysis">,
    itemId?: string,
  ) =>
    apiFetch<{ run: Record<string, any> }>(
      `/api/repositories/${encodeURIComponent(repo)}/refresh/${taskType}`,
      {
        method: "POST",
        body: JSON.stringify(itemId ? { itemId } : {}),
      },
    ),

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

  communityPage: fetchCommunityPage,

  // Small consumers such as insight target pickers only need the requested page.
  community: async (params: CommunityPageQuery = {}) =>
    (await fetchCommunityPage(params)).items,

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
    requirement = "",
  ) =>
    apiFetch<{ job?: LocalAnalysisJob | null; analysis?: AnalysisDocument | null }>(
      `/api/community/${encodeURIComponent(repo)}/${kind}/${number}/analyze`,
      {
        method: "POST",
        body: JSON.stringify({ requirement }),
      },
    ),

  watchlist: async () => {
    const result = await apiFetch<{ items: any[] }>("/api/watchlist");
    return result.items.map((item) => ({
      item: mapCommunityItem(item),
      watch: item.watch,
    }));
  },

  addWatch: (itemId: string, meta: Partial<WatchlistMeta> = {}) =>
    apiFetch<{ ok: boolean }>(`/api/watchlist/${encodeURIComponent(itemId)}`, {
      method: "POST",
      body: JSON.stringify(meta),
    }),

  removeWatch: (itemId: string) =>
    apiFetch<void>(`/api/watchlist/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    }),

};
