import { computed, ref } from "vue";
import { api } from "../api/client";
import { domainOptions } from "../data/community";
import { communityItemKey } from "../data/workspace";
import type {
  AppView,
  CommunityItem,
  RepositoryId,
  RepositoryMeta,
  TodaySummary,
} from "../types";

const fallbackRepository: RepositoryMeta = {
  id: "vllm-ascend",
  owner: "vllm-project",
  name: "vllm-ascend",
  description: "vLLM 的 Ascend NPU 设备插件",
  stars: "",
  openPulls: 0,
  openIssues: 0,
};

export function useCommunityWorkspace() {
  const activeRepo = ref<RepositoryId>("vllm-ascend");
  const activeView = ref<AppView>("pulls");
  const selectedDomain = ref("全部领域");
  const searchQuery = ref("");
  const stateFilter = ref("全部状态");
  const refreshing = ref(false);
  const listLoading = ref(false);
  const todayLoading = ref(false);
  const repositoryData = ref<RepositoryMeta[]>([]);
  const communityData = ref<CommunityItem[]>([]);
  const watchedKeys = ref<Set<string>>(new Set());
  const documentCount = ref(0);
  const todaySummaries = ref<Record<string, TodaySummary>>({});
  const impactCount = ref(0);
  const insightCount = ref(0);

  const currentRepo = computed(
    () =>
      repositoryData.value.find((repo) => repo.id === activeRepo.value) ??
      repositoryData.value[0] ??
      fallbackRepository,
  );

  const watchlistItems = computed(() =>
    communityData.value.filter((item) =>
      watchedKeys.value.has(communityItemKey(item)),
    ),
  );

  const workspaceHeader = computed(() => {
    const contexts: Partial<
      Record<
        AppView,
        { owner: string; title: string; icon: string; badge: string }
      >
    > = {
      insights: {
        owner: "工作台",
        title: "AI 洞察",
        icon: "sparkle-fill",
        badge: "跨仓库 AI",
      },
      watchlist: {
        owner: "工作台",
        title: "关注列表",
        icon: "star",
        badge: "跨仓库",
      },
      impact: {
        owner: "工作台",
        title: "跨仓库影响",
        icon: "git-compare",
        badge: "适配视图",
      },
      domains: {
        owner: "领域工作空间",
        title: "技术领域地图",
        icon: "stack",
        badge: "6 个领域",
      },
      docs: {
        owner: "知识库",
        title: "技术文档",
        icon: "book",
        badge: "Markdown",
      },
      chat: {
        owner: "工作台",
        title: "AI 对话",
        icon: "comment-discussion",
        badge: "上下文问答",
      },
      settings: {
        owner: "个人空间",
        title: "设置",
        icon: "gear",
        badge: "账户与 AI",
      },
    };
    return contexts[activeView.value] ?? null;
  });

  const filteredItems = computed(() => {
    const kind = activeView.value === "issues" ? "issue" : "pr";
    const query = searchQuery.value.trim().toLowerCase();
    const recentSnapshot = communityData.value
      .filter((item) => item.repo === activeRepo.value && item.kind === kind)
      .sort(
        (left, right) =>
          new Date(right.updatedAt || 0).valueOf() -
          new Date(left.updatedAt || 0).valueOf(),
      )
      .slice(0, 30);

    return recentSnapshot.filter((item) => {
      const matchesDomain =
        selectedDomain.value === "全部领域" ||
        item.domain === selectedDomain.value;
      const matchesState =
        stateFilter.value === "全部状态" ||
        (stateFilter.value === "开放中" && item.state === "open") ||
        (stateFilter.value === "Draft" && item.state === "draft") ||
        (stateFilter.value === "已合入" && item.state === "merged") ||
        (stateFilter.value === "已关闭" && item.state === "closed") ||
        (stateFilter.value === "重新打开" &&
          item.lastEventType === "reopened");
      const matchesQuery =
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.summary.toLowerCase().includes(query) ||
        item.author.toLowerCase().includes(query) ||
        String(item.id).includes(query);

      return matchesDomain && matchesState && matchesQuery;
    });
  });

  const activeKindLabel = computed(() =>
    activeView.value === "issues" ? "Issue" : "Pull Request",
  );

  const domainFilterOptions = domainOptions.map((domain) => {
    const details: Record<
      string,
      {
        description: string;
        tone?: "accent" | "blue" | "neutral" | "purple";
      }
    > = {
      全部领域: {
        description: "显示当前仓库的所有技术领域",
        tone: "accent",
      },
      "Model Runner": {
        description: "模型执行、批处理与图模式",
        tone: "blue",
      },
      FusedMoE: {
        description: "专家路由、融合算子与 MoE",
        tone: "purple",
      },
      Scheduler: { description: "调度、KV Cache 与推测解码" },
      Attention: {
        description: "Attention、MLA 与 KV 路径",
        tone: "blue",
      },
      "CI / Infra": { description: "工作流、构建与基础设施" },
      Distributed: { description: "并行策略、多机与通信" },
      Quantization: { description: "量化格式、精度与算子" },
      "Serving / API": { description: "服务入口、协议与客户端" },
      "Model Support": { description: "模型实现、加载与适配" },
      "Platform / Hardware": { description: "设备后端与底层算子" },
      Documentation: { description: "文档、示例与开发指引" },
      Tests: { description: "单元测试、集成与回归验证" },
      Other: {
        description: "尚未归入明确领域的改动",
        tone: "neutral",
      },
    };

    return {
      value: domain,
      label: domain,
      description: details[domain]?.description,
      tone: details[domain]?.tone ?? "neutral",
    };
  });

  const stateFilterOptions = computed(() => [
    {
      value: "全部状态",
      label: "全部状态",
      description: "不限制条目的当前状态",
      tone: "accent" as const,
    },
    {
      value: "开放中",
      label: "开放中",
      description: "等待处理或 Review",
      tone: "green" as const,
    },
    ...(activeView.value === "pulls"
      ? [
          {
            value: "Draft",
            label: "Draft",
            description: "仍在准备中的 Pull Request",
            tone: "neutral" as const,
          },
          {
            value: "已合入",
            label: "已合入",
            description: "改动已经合并到目标分支",
            tone: "purple" as const,
          },
        ]
      : []),
    {
      value: "已关闭",
      label: "已关闭",
      description: "已关闭且未合入",
      tone: "red" as const,
    },
    {
      value: "重新打开",
      label: "重新打开",
      description: "关闭后再次恢复处理",
      tone: "orange" as const,
    },
  ]);

  async function loadApplicationData() {
    listLoading.value = true;
    try {
      const [repos, items, watchItems, documents, insights, impacts] =
        await Promise.all([
          api.repositories(),
          api.community({ limit: 200 }),
          api.watchlist(),
          api.documents(),
          api.analyses("insight", "all"),
          api.impacts(),
        ]);
      repositoryData.value = repos;
      communityData.value = items;
      watchedKeys.value = new Set(
        watchItems.map(({ item }) => communityItemKey(item)),
      );
      documentCount.value = documents.length;
      insightCount.value = insights.length;
      impactCount.value = impacts.length;
      const today = await Promise.all(repos.map((repo) => api.today(repo.id)));
      todaySummaries.value = Object.fromEntries(
        today.map((summary) => [summary.repo, summary]),
      );
    } finally {
      listLoading.value = false;
    }
  }

  async function refreshData() {
    refreshing.value = true;
    todayLoading.value = true;
    listLoading.value = ["pulls", "issues"].includes(activeView.value);
    try {
      const syncResult = await api.syncRepository(activeRepo.value);
      const [repos, items, today, impacts, insights] = await Promise.all([
        api.repositories(),
        api.community({ limit: 200 }),
        api.today(activeRepo.value),
        api.impacts(),
        api.analyses("insight", "all"),
      ]);
      repositoryData.value = repos;
      communityData.value = items;
      todaySummaries.value = {
        ...todaySummaries.value,
        [activeRepo.value]: today,
      };
      impactCount.value = impacts.length;
      insightCount.value = insights.length;
      return (
        syncResult.run.warning ||
        `同步完成：${syncResult.run.capturedEvents} 条状态事件，${syncResult.run.analyzed} 条 AI 摘要`
      );
    } finally {
      refreshing.value = false;
      todayLoading.value = false;
      listLoading.value = false;
    }
  }

  async function toggleWatch(item: CommunityItem) {
    const key = communityItemKey(item);
    const next = new Set(watchedKeys.value);
    const removing = next.has(key);
    if (removing) {
      await api.removeWatch(key);
      next.delete(key);
    } else {
      await api.addWatch(key, { reason: "持续关注", priority: "P2" });
      next.add(key);
    }
    watchedKeys.value = next;
    return removing;
  }

  function clearFilters() {
    selectedDomain.value = "全部领域";
    stateFilter.value = "全部状态";
    searchQuery.value = "";
  }

  function clearUserData() {
    communityData.value = [];
    watchedKeys.value = new Set();
  }

  return {
    activeKindLabel,
    activeRepo,
    activeView,
    clearFilters,
    clearUserData,
    communityData,
    currentRepo,
    documentCount,
    domainFilterOptions,
    filteredItems,
    impactCount,
    insightCount,
    listLoading,
    loadApplicationData,
    refreshData,
    refreshing,
    repositoryData,
    searchQuery,
    selectedDomain,
    stateFilter,
    stateFilterOptions,
    todayLoading,
    todaySummaries,
    toggleWatch,
    watchedKeys,
    watchlistItems,
    workspaceHeader,
  };
}
