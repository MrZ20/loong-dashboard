import { computed, onBeforeUnmount, ref, watch } from "vue";
import { communityApi } from "../api/community";
import { contentApi } from "../api/content";
import { communityItemKey } from "../domain/community-item";
import { normalizeDateRange } from "../domain/community-date-range";
import {
  COMMUNITY_PAGE_SIZE,
  communityPageMeta,
} from "../domain/community-pagination";
import type { CommunitySortMode } from "../domain/community-sorting";
import type {
  AppView,
  RepositoryId,
} from "../types/core";
import type {
  CommunityItem,
  RepositoryMeta,
  TodaySummary,
  WatchlistMeta,
} from "../types/community";

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
  const updatedFrom = ref("");
  const updatedTo = ref("");
  const currentPage = ref(1);
  const refreshing = ref(false);
  const listLoading = ref(false);
  const todayLoading = ref(false);
  const repositoryData = ref<RepositoryMeta[]>([]);
  const communityData = ref<CommunityItem[]>([]);
  const communityTotal = ref(0);
  const communityDomains = ref<Array<{
    value: string;
    label: string;
    description: string;
  }>>([]);
  const watchedKeys = ref<Set<string>>(new Set());
  const watchlistMeta = ref<Record<string, WatchlistMeta>>({});
  const watchlistItems = ref<CommunityItem[]>([]);
  const documentCount = ref(0);
  const todaySummaries = ref<Record<string, TodaySummary>>({});
  const impactCount = ref(0);
  const insightCount = ref(0);
  let factsPollTimer: ReturnType<typeof setTimeout> | null = null;
  let communityLoadTimer: ReturnType<typeof setTimeout> | null = null;
  let communityRequestId = 0;

  const currentRepo = computed(
    () =>
      repositoryData.value.find((repo) => repo.id === activeRepo.value) ??
      repositoryData.value[0] ??
      fallbackRepository,
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

  const pagination = computed(() => communityPageMeta(
    communityTotal.value,
    currentPage.value,
    communityData.value.length,
  ));
  const paginatedItems = computed(() => communityData.value);

  watch(
    [
      activeRepo,
      activeView,
      selectedDomain,
      searchQuery,
      stateFilter,
      sortMode,
      updatedFrom,
      updatedTo,
    ],
    () => {
      if (currentPage.value !== 1) {
        currentPage.value = 1;
      } else {
        scheduleCommunityPageLoad();
      }
    },
  );
  watch(
    currentPage,
    () => scheduleCommunityPageLoad(),
  );

  const activeKindLabel = computed(() =>
    activeView.value === "issues" ? "Issue" : "Pull Request",
  );

  const domainFilterOptions = computed(() => {
    const domains = [
      {
        value: "全部领域",
        label: "全部领域",
        description: "显示当前仓库的所有技术领域",
      },
      ...communityDomains.value,
    ];
    const tones = ["blue", "purple", "green", "orange"] as const;
    return domains.map((domain, index) => ({
      ...domain,
      tone: domain.value === "全部领域"
        ? "accent" as const
        : domain.value === "Other"
          ? "neutral" as const
          : tones[(index - 1) % tones.length],
    }));
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

  function isCommunityListView() {
    return activeView.value === "pulls" || activeView.value === "issues";
  }

  function selectedStateQuery() {
    const states = {
      开放中: "open",
      Draft: "draft",
      已合入: "merged",
      已关闭: "closed",
      重新打开: "reopened",
    } as const;
    return states[stateFilter.value as keyof typeof states];
  }

  function communityPageQuery(repoId = activeRepo.value) {
    const range = normalizeDateRange(updatedFrom.value, updatedTo.value);
    return {
      repo: repoId,
      kind: activeView.value === "issues" ? "issue" as const : "pr" as const,
      domain:
        selectedDomain.value === "全部领域"
          ? undefined
          : selectedDomain.value,
      state: selectedStateQuery(),
      q: searchQuery.value.trim() || undefined,
      from: range.from || undefined,
      to: range.to || undefined,
      sort: sortMode.value,
      limit: COMMUNITY_PAGE_SIZE,
      offset: (currentPage.value - 1) * COMMUNITY_PAGE_SIZE,
    };
  }

  function applyCommunityPage(page: Awaited<ReturnType<typeof communityApi.communityPage>>) {
    communityData.value = page.items;
    communityTotal.value = page.total;
    communityDomains.value = page.domainOptions;

    if (
      selectedDomain.value !== "全部领域" &&
      !page.domainOptions.some((domain) => domain.value === selectedDomain.value)
    ) {
      selectedDomain.value = "全部领域";
      return;
    }

    const refreshed = new Map(
      page.items.map((item) => [communityItemKey(item), item]),
    );
    watchlistItems.value = watchlistItems.value.map(
      (item) => refreshed.get(communityItemKey(item)) ?? item,
    );
  }

  function upsertCommunityItem(item: CommunityItem) {
    const key = communityItemKey(item);
    communityData.value = communityData.value.map((candidate) =>
      communityItemKey(candidate) === key ? item : candidate
    );
    watchlistItems.value = watchlistItems.value.map((candidate) =>
      communityItemKey(candidate) === key ? item : candidate
    );
    if (
      item.repo === activeRepo.value &&
      item.domain &&
      !communityDomains.value.some((option) => option.value === item.domain)
    ) {
      communityDomains.value = [
        ...communityDomains.value,
        {
          value: item.domain,
          label: item.domain,
          description: "该领域来自当前仓库已同步的分类结果。",
        },
      ].sort((left, right) => left.label.localeCompare(right.label));
    }
  }

  async function loadCommunityPage(
    repoId = activeRepo.value,
    requestId = ++communityRequestId,
  ) {
    if (!isCommunityListView() || repoId !== activeRepo.value) return;
    listLoading.value = true;
    try {
      const page = await communityApi.communityPage(communityPageQuery(repoId));
      if (requestId !== communityRequestId) return;
      const totalPages = Math.max(
        1,
        Math.ceil(page.total / COMMUNITY_PAGE_SIZE),
      );
      if (currentPage.value > totalPages) {
        currentPage.value = totalPages;
        return;
      }
      applyCommunityPage(page);
    } finally {
      if (requestId === communityRequestId) listLoading.value = false;
    }
  }

  function scheduleCommunityPageLoad() {
    if (communityLoadTimer) clearTimeout(communityLoadTimer);
    const requestId = ++communityRequestId;
    if (!isCommunityListView()) {
      listLoading.value = false;
      return;
    }
    listLoading.value = true;
    communityLoadTimer = setTimeout(() => {
      communityLoadTimer = null;
      void loadCommunityPage(activeRepo.value, requestId).catch(() => undefined);
    }, 180);
  }

  async function loadApplicationData() {
    const [repos, , watchItems, documents, insights, impacts] =
      await Promise.all([
        communityApi.repositories(),
        loadCommunityPage(),
        communityApi.watchlist(),
        contentApi.documents(),
        contentApi.analyses("insight", "all"),
        communityApi.impacts(),
      ]);
    repositoryData.value = repos;
    watchedKeys.value = new Set(
      watchItems.map(({ item }) => communityItemKey(item)),
    );
    watchlistItems.value = watchItems.map(({ item }) => item);
    watchlistMeta.value = Object.fromEntries(
      watchItems.map(({ item, watch }) => [communityItemKey(item), watch]),
    );
    documentCount.value = documents.length;
    insightCount.value = insights.length;
    impactCount.value = impacts.length;
    const today = await Promise.all(repos.map((repo) => communityApi.today(repo.id)));
    todaySummaries.value = Object.fromEntries(
      today.map((summary) => [summary.repo, summary]),
    );
  }

  async function reloadCommunitySnapshot(repoId: RepositoryId) {
    const shouldReloadList = repoId === activeRepo.value && isCommunityListView();
    const [repos, , today, impacts, watchItems] = await Promise.all([
      communityApi.repositories(),
      shouldReloadList
        ? loadCommunityPage(repoId)
        : Promise.resolve(),
      communityApi.today(repoId),
      communityApi.impacts(),
      communityApi.watchlist(),
    ]);
    repositoryData.value = repos;
    watchedKeys.value = new Set(
      watchItems.map(({ item }) => communityItemKey(item)),
    );
    watchlistItems.value = watchItems.map(({ item }) => item);
    watchlistMeta.value = Object.fromEntries(
      watchItems.map(({ item, watch }) => [communityItemKey(item), watch]),
    );
    todaySummaries.value = { ...todaySummaries.value, [repoId]: today };
    impactCount.value = impacts.length;
  }

  async function refreshData() {
    refreshing.value = true;
    todayLoading.value = true;
    try {
      const syncResult = await communityApi.refreshRepositoryTask(activeRepo.value, "facts");
      const [repos, , today, impacts, insights] = await Promise.all([
        communityApi.repositories(),
        loadCommunityPage(),
        communityApi.today(activeRepo.value),
        communityApi.impacts(),
        contentApi.analyses("insight", "all"),
      ]);
      repositoryData.value = repos;
      todaySummaries.value = {
        ...todaySummaries.value,
        [activeRepo.value]: today,
      };
      impactCount.value = impacts.length;
      insightCount.value = insights.length;
      const refreshedRepository = repos.find(
        (repo) => repo.id === activeRepo.value,
      );
      if (syncResult.run.status === "queued") {
        scheduleFactsPoll(activeRepo.value);
        return "社区事实刷新已进入后台队列；可以继续浏览，完成后列表与刷新状态会更新";
      }
      return (
        `社区事实刷新完成：本次更新 ${Number(syncResult.run.pulls ?? 0)} 个 PR、${Number(syncResult.run.issues ?? 0)} 个 Issue；` +
        `当前列表共 ${refreshedRepository?.openPulls ?? 0} 个 PR、${refreshedRepository?.openIssues ?? 0} 个 Issue；未调用 AI 或重新分类`
      );
    } finally {
      refreshing.value = false;
      todayLoading.value = false;
    }
  }

  function scheduleFactsPoll(repoId: RepositoryId) {
    if (factsPollTimer) clearTimeout(factsPollTimer);
    factsPollTimer = setTimeout(async () => {
      try {
        const repos = await communityApi.repositories();
        repositoryData.value = repos;
        const facts = repos
          .find((repo) => repo.id === repoId)
          ?.refreshTasks?.find((task) => task.taskType === "facts");
        if (facts && ["queued", "running"].includes(facts.status)) {
          scheduleFactsPoll(repoId);
          return;
        }
        await reloadCommunitySnapshot(repoId);
      } catch {
        scheduleFactsPoll(repoId);
      }
    }, 2_500);
  }

  onBeforeUnmount(() => {
    if (factsPollTimer) clearTimeout(factsPollTimer);
    if (communityLoadTimer) clearTimeout(communityLoadTimer);
  });

  async function toggleWatch(item: CommunityItem) {
    const key = communityItemKey(item);
    const next = new Set(watchedKeys.value);
    const removing = next.has(key);
    if (removing) {
      await communityApi.removeWatch(key);
      next.delete(key);
      watchlistItems.value = watchlistItems.value.filter(
        (candidate) => communityItemKey(candidate) !== key,
      );
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
      await communityApi.addWatch(key, meta);
      next.add(key);
      if (!watchlistItems.value.some((candidate) => communityItemKey(candidate) === key)) {
        watchlistItems.value = [...watchlistItems.value, item];
      }
      watchlistMeta.value = { ...watchlistMeta.value, [key]: meta };
    }
    watchedKeys.value = next;
    return removing;
  }

  function clearFilters() {
    selectedDomain.value = "全部领域";
    stateFilter.value = "全部状态";
    searchQuery.value = "";
    updatedFrom.value = "";
    updatedTo.value = "";
  }

  function clearUserData() {
    communityData.value = [];
    communityTotal.value = 0;
    communityDomains.value = [];
    watchedKeys.value = new Set();
    watchlistMeta.value = {};
    watchlistItems.value = [];
  }

  return {
    activeKindLabel,
    activeRepo,
    activeView,
    clearFilters,
    clearUserData,
    communityData,
    communityTotal,
    currentPage,
    currentRepo,
    documentCount,
    domainFilterOptions,
    impactCount,
    insightCount,
    listLoading,
    loadApplicationData,
    paginatedItems,
    pagination,
    pageSize: COMMUNITY_PAGE_SIZE,
    refreshData,
    refreshing,
    reloadCommunitySnapshot,
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
    upsertCommunityItem,
    updatedFrom,
    updatedTo,
    watchedKeys,
    watchlistMeta,
    watchlistItems,
    workspaceHeader,
  };
}
