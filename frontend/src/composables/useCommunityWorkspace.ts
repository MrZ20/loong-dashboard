import { computed, ref } from "vue";
import { api } from "../api/client";
import { communityItemKey } from "../domain/community-item";
import {
  sortCommunityItems,
  type CommunitySortMode,
} from "../domain/community-sorting";
import type {
  AppView,
  CommunityItem,
  RepositoryId,
  RepositoryMeta,
  TodaySummary,
  WatchlistMeta,
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
  const sortMode = ref<CommunitySortMode>("updated");
  const refreshing = ref(false);
  const listLoading = ref(false);
  const todayLoading = ref(false);
  const repositoryData = ref<RepositoryMeta[]>([]);
  const communityData = ref<CommunityItem[]>([]);
  const watchedKeys = ref<Set<string>>(new Set());
  const watchlistMeta = ref<Record<string, WatchlistMeta>>({});
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
        badge: "架构与变化",
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
    const matchingItems = communityData.value.filter((item) => {
      if (item.repo !== activeRepo.value || item.kind !== kind) return false;
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
    return sortCommunityItems(matchingItems, sortMode.value);
  });

  const activeKindLabel = computed(() =>
    activeView.value === "issues" ? "Issue" : "Pull Request",
  );

  const domainFilterOptions = computed(() => {
    const domains = [
      "全部领域",
      ...new Set(
        communityData.value
          .filter((item) => item.repo === activeRepo.value)
          .map((item) => item.domain)
          .filter(Boolean),
      ),
    ];
    return domains.map((domain) => {
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
      "Engine & Model Runner": {
        description: "模型执行、批处理与图模式",
        tone: "blue",
      },
      "Worker & Graph": { description: "Ascend Worker、Model Runner 与图模式", tone: "blue" },
      "FusedMoE & Expert Parallelism": {
        description: "专家路由、融合算子与 MoE",
        tone: "purple",
      },
      "FusedMoE & Custom Ops": { description: "Ascend MoE 与 NPU 自定义算子", tone: "purple" },
      "Scheduler & KV Cache": { description: "上游调度与 KV Cache 生命周期" },
      "Core Scheduler & KV Cache": { description: "Ascend Core、调度与 KV Cache" },
      Attention: {
        description: "Attention、MLA 与 KV 路径",
        tone: "blue",
      },
      "CI / Infra": { description: "工作流、构建与基础设施" },
      "Distributed & KV Transfer": { description: "并行通信、KV Connector 与 PD 解耦" },
      Quantization: { description: "量化格式、精度与算子" },
      "Serving & APIs": { description: "服务入口、协议与客户端" },
      "Model Support & Weight Loading": { description: "模型实现、注册与权重加载" },
      "Model Loading & Weight Transfer": { description: "Ascend 模型加载与在线权重更新" },
      "Platform & Hardware": { description: "设备后端与硬件抽象" },
      "Platform & Patches": { description: "Ascend 平台注册与兼容 patch" },
      "Compilation & Kernels": { description: "编译、IR 与通用内核" },
      Compilation: { description: "Ascend 编译与融合优化" },
      "Speculative Decoding": { description: "MTP、EAGLE 与推测解码" },
      "Sampling & Structured Output": { description: "采样、约束输出与解析" },
      Sampling: { description: "Ascend 采样与 logits 处理" },
      "Rust Frontend": { description: "Rust Server、CLI 与 Engine Client" },
      EPLB: { description: "专家放置与动态负载均衡" },
      "KV Offload": { description: "KV Cache 外部介质卸载" },
      "Device & Memory": { description: "NPU 设备、内存与资源生命周期" },
      XLite: { description: "XLite 独立执行后端" },
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

  const sortOptions = [
    {
      value: "updated",
      label: "最近更新",
      description: "按 GitHub 更新时间排序，最新变化在上",
      tone: "accent" as const,
    },
    {
      value: "number",
      label: "编号倒序",
      description: "按 PR 或 Issue 编号从大到小排序",
      tone: "blue" as const,
    },
  ];

  async function loadApplicationData() {
    listLoading.value = true;
    try {
      const [repos, items, watchItems, documents, insights, impacts] =
        await Promise.all([
          api.repositories(),
          api.communityAll(),
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
      watchlistMeta.value = Object.fromEntries(
        watchItems.map(({ item, watch }) => [communityItemKey(item), watch]),
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
      const syncResult = await api.refreshRepositoryTask(activeRepo.value, "facts");
      const [repos, items, today, impacts, insights] = await Promise.all([
        api.repositories(),
        api.communityAll(),
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
      const refreshedRepository = repos.find(
        (repo) => repo.id === activeRepo.value,
      );
      return (
        `社区事实刷新完成：本次更新 ${Number(syncResult.run.pulls ?? 0)} 个 PR、${Number(syncResult.run.issues ?? 0)} 个 Issue；` +
        `当前列表共 ${refreshedRepository?.openPulls ?? 0} 个 PR、${refreshedRepository?.openIssues ?? 0} 个 Issue；未调用 AI 或重新分类`
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
      const nextMeta = { ...watchlistMeta.value };
      delete nextMeta[key];
      watchlistMeta.value = nextMeta;
    } else {
      const meta: WatchlistMeta = {
        reason: "持续关注",
        note: "尚未添加个人备注。",
        priority: "P2",
        nextCheck: "明天",
      };
      await api.addWatch(key, meta);
      next.add(key);
      watchlistMeta.value = { ...watchlistMeta.value, [key]: meta };
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
    watchlistMeta.value = {};
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
    sortMode,
    sortOptions,
    stateFilter,
    stateFilterOptions,
    todayLoading,
    todaySummaries,
    toggleWatch,
    watchedKeys,
    watchlistMeta,
    watchlistItems,
    workspaceHeader,
  };
}
