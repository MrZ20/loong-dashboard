import type {
  AnalysisDocument,
  CrossRepoImpact,
  RepositoryMeta,
  TodaySummary,
} from "../types";
import { apiFetch } from "./core";
import { mapCommunityItem } from "./mappers";

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

};

