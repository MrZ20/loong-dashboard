<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "./api/client";
import AIChatDock from "./components/AIChatDock.vue";
import AIChatView from "./components/AIChatView.vue";
import AIInsightsView from "./components/AIInsightsView.vue";
import AppSidebar from "./components/AppSidebar.vue";
import CommunityList from "./components/CommunityList.vue";
import CrossRepoImpactView from "./components/CrossRepoImpactView.vue";
import DailyAnalysis from "./components/DailyAnalysis.vue";
import DetailDrawer from "./components/DetailDrawer.vue";
import DomainMapView from "./components/DomainMapView.vue";
import InsightBanner from "./components/InsightBanner.vue";
import LoginView from "./components/LoginView.vue";
import Octicon from "./components/Octicon.vue";
import RepositoryHeader from "./components/RepositoryHeader.vue";
import TechnicalDocsView from "./components/TechnicalDocsView.vue";
import WatchlistView from "./components/WatchlistView.vue";
import {
  domainOptions,
} from "./data/community";
import {
  aiInsights,
  communityItemKey,
  crossRepoImpacts,
} from "./data/workspace";
import { useAIChat } from "./composables/useAIChat";
import type {
  AnalysisDocument,
  AppView,
  AuthUser,
  CommunityItem,
  RepositoryMeta,
  RepositoryId,
  ThemeMode,
} from "./types";

const activeRepo = ref<RepositoryId>("vllm-ascend");
const activeView = ref<AppView>("pulls");
const selectedDomain = ref("全部领域");
const searchQuery = ref("");
const stateFilter = ref("全部状态");
const selectedItem = ref<CommunityItem | null>(null);
const refreshing = ref(false);
const listLoading = ref(false);
const sidebarOpen = ref(false);
const toast = ref("");
const authUser = ref<AuthUser | null>(null);
const authMode = ref<"development" | "chatgpt">("chatgpt");
const signInPath = ref("/signin-with-chatgpt?return_to=/");
const signOutPath = ref("/signout-with-chatgpt?return_to=/login");
const authLoading = ref(true);
const loginLoading = ref(false);
const authError = ref("");
const repositoryData = ref<RepositoryMeta[]>([]);
const communityData = ref<CommunityItem[]>([]);
const watchedKeys = ref<Set<string>>(new Set());
const documentCount = ref(0);
const detailAnalysis = ref<AnalysisDocument | null>(null);
const detailAnalyzing = ref(false);
const { setPageContext } = useAIChat();
const storedTheme = window.localStorage.getItem("loongboard-theme");
const theme = ref<ThemeMode>(
  storedTheme === "dark" || storedTheme === "light"
    ? storedTheme
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
);

const fallbackRepository: RepositoryMeta = {
  id: "vllm-ascend",
  owner: "vllm-project",
  name: "vllm-ascend",
  description: "vLLM 的 Ascend NPU 设备插件",
  stars: "",
  openPulls: 0,
  openIssues: 0,
};

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
    Record<AppView, { owner: string; title: string; icon: string; badge: string }>
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
  };
  return contexts[activeView.value] ?? null;
});

const filteredItems = computed(() => {
  const kind = activeView.value === "issues" ? "issue" : "pr";
  const query = searchQuery.value.trim().toLowerCase();

  return communityData.value.filter((item) => {
    const matchesRepo = item.repo === activeRepo.value;
    const matchesKind = item.kind === kind;
    const matchesDomain =
      selectedDomain.value === "全部领域" || item.domain === selectedDomain.value;
    const matchesState =
      stateFilter.value === "全部状态" ||
      (stateFilter.value === "开放中" && ["open", "draft"].includes(item.state)) ||
      (stateFilter.value === "已合入" && item.state === "merged") ||
      (stateFilter.value === "已关闭" && item.state === "closed");
    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query) ||
      item.summary.toLowerCase().includes(query) ||
      item.author.toLowerCase().includes(query) ||
      String(item.id).includes(query);

    return matchesRepo && matchesKind && matchesDomain && matchesState && matchesQuery;
  });
});

const activeKindLabel = computed(() =>
  activeView.value === "issues" ? "Issue" : "Pull Request",
);

watch([activeRepo, activeView], () => {
  selectedItem.value = null;
  detailAnalysis.value = null;
  sidebarOpen.value = false;
  if (["pulls", "issues"].includes(activeView.value)) {
    listLoading.value = true;
    window.setTimeout(() => {
      listLoading.value = false;
    }, 260);
  }
});

watch(
  theme,
  (value) => {
    window.localStorage.setItem("loongboard-theme", value);
    document.documentElement.style.colorScheme = value;
  },
  { immediate: true },
);

watch(
  [activeView, activeRepo, selectedItem],
  () => {
    const item = selectedItem.value;
    setPageContext(
      item
        ? `${item.repo} ${item.kind.toUpperCase()} #${item.id}\n${item.title}\n${item.bodyMd || item.body}`
        : `LoongBoard 页面：${workspaceHeader.value?.title || activeView.value}\n当前仓库：${activeRepo.value}`,
    );
  },
  { immediate: true },
);

function changeRepo(repo: RepositoryId) {
  activeRepo.value = repo;
}

function changeView(view: AppView) {
  activeView.value = view;
}

async function loadApplicationData() {
  const [repos, items, watchItems, documents] = await Promise.all([
    api.repositories(),
    api.community({ limit: 200 }),
    api.watchlist(),
    api.documents(),
  ]);
  repositoryData.value = repos;
  communityData.value = items;
  watchedKeys.value = new Set(
    watchItems.map(({ item }) => communityItemKey(item)),
  );
  documentCount.value = documents.length;
}

async function initializeAuth() {
  authLoading.value = true;
  authError.value = "";
  try {
    const providers = await api.authProviders();
    authMode.value = providers.mode;
    signInPath.value = providers.signInPath;
    signOutPath.value = providers.signOutPath;
    const { user } = await api.me();
    authUser.value = user;
    await loadApplicationData();
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      authUser.value = null;
    } else {
      authError.value =
        cause instanceof ApiError ? cause.message : "后端服务连接失败";
    }
  } finally {
    authLoading.value = false;
  }
}

async function login(email: string, displayName: string) {
  loginLoading.value = true;
  authError.value = "";
  try {
    await api.devLogin(email, displayName);
    await initializeAuth();
  } catch (cause) {
    authError.value =
      cause instanceof ApiError ? cause.message : "登录失败";
  } finally {
    loginLoading.value = false;
  }
}

async function logout() {
  if (authMode.value === "chatgpt") {
    window.location.href = signOutPath.value;
    return;
  }
  await api.logout();
  authUser.value = null;
  communityData.value = [];
  watchedKeys.value = new Set();
}

async function refreshData() {
  refreshing.value = true;
  listLoading.value = ["pulls", "issues"].includes(activeView.value);
  try {
    await api.syncRepository(activeRepo.value);
    const [repos, items] = await Promise.all([
      api.repositories(),
      api.community({ limit: 200 }),
    ]);
    repositoryData.value = repos;
    communityData.value = items;
    showToast("GitHub 社区数据已同步");
  } catch (cause) {
    showToast(
      cause instanceof ApiError ? cause.message : "GitHub 同步失败",
    );
  } finally {
    refreshing.value = false;
    listLoading.value = false;
  }
}

function clearFilters() {
  selectedDomain.value = "全部领域";
  stateFilter.value = "全部状态";
  searchQuery.value = "";
}

function showToast(message: string) {
  toast.value = message;
  window.setTimeout(() => {
    toast.value = "";
  }, 2_200);
}

async function toggleWatch(item: CommunityItem) {
  const key = communityItemKey(item);
  const next = new Set(watchedKeys.value);
  const removing = next.has(key);
  try {
    if (removing) {
      await api.removeWatch(key);
      next.delete(key);
    } else {
      await api.addWatch(key, { reason: "持续关注", priority: "P2" });
      next.add(key);
    }
    watchedKeys.value = next;
    showToast(removing ? `已取消关注 #${item.id}` : `已加入关注 #${item.id}`);
  } catch (cause) {
    showToast(cause instanceof ApiError ? cause.message : "关注状态更新失败");
  }
}

async function selectCommunityItem(item: CommunityItem) {
  selectedItem.value = item;
  detailAnalysis.value = null;
  try {
    const result = await api.communityItem(item.repo, item.kind, item.id);
    selectedItem.value = result.item;
    detailAnalysis.value = result.analyses[0] ?? null;
  } catch (cause) {
    showToast(cause instanceof ApiError ? cause.message : "详情加载失败");
  }
}

async function analyzeSelectedItem(item: CommunityItem) {
  detailAnalyzing.value = true;
  try {
    const result = await api.analyzeCommunityItem(
      item.repo,
      item.kind,
      item.id,
    );
    detailAnalysis.value = result.analysis;
    showToast(
      result.provider === "api"
        ? "AI 深度分析已生成"
        : "已生成离线分析；配置 AI API 后可获得模型结果",
    );
  } catch (cause) {
    showToast(cause instanceof ApiError ? cause.message : "深度分析失败");
  } finally {
    detailAnalyzing.value = false;
  }
}

onMounted(initializeAuth);
</script>

<template>
  <div v-if="authLoading" class="app-shell auth-loading-page" :data-theme="theme">
    <span class="analysis-orbit"><Octicon name="telescope" :size="24" /></span>
    <strong>正在连接 LoongBoard 服务…</strong>
  </div>

  <div v-else-if="!authUser" class="app-shell" :data-theme="theme">
    <LoginView
      :mode="authMode"
      :sign-in-path="signInPath"
      :loading="loginLoading"
      :error="authError"
      @login="login"
    />
  </div>

  <div v-else class="app-shell" :data-theme="theme">
    <AppSidebar
      :repositories="repositoryData"
      :active-repo="activeRepo"
      :active-view="activeView"
      :insight-count="aiInsights.length"
      :watchlist-count="watchlistItems.length"
      :impact-count="crossRepoImpacts.length"
      :document-count="documentCount"
      :user-name="authUser.displayName"
      :user-email="authUser.email"
      :open="sidebarOpen"
      @update:repo="changeRepo"
      @update:view="changeView"
      @logout="logout"
      @close="sidebarOpen = false"
    />
    <div
      v-if="sidebarOpen"
      class="sidebar-mobile-backdrop"
      @click="sidebarOpen = false"
    />

    <main class="main-canvas">
      <RepositoryHeader
        :repo="currentRepo"
        :refreshing="refreshing"
        :theme="theme"
        :context="workspaceHeader"
        @refresh="refreshData"
        @update:theme="theme = $event"
        @open-menu="sidebarOpen = true"
      />

      <div class="content-area">
        <AIInsightsView v-if="activeView === 'insights'" />
        <WatchlistView
          v-else-if="activeView === 'watchlist'"
          :items="watchlistItems"
          @select="selectCommunityItem"
          @toggle="toggleWatch"
        />
        <CrossRepoImpactView v-else-if="activeView === 'impact'" />
        <DomainMapView v-else-if="activeView === 'domains'" />
        <TechnicalDocsView
          v-else-if="activeView === 'docs'"
          @update:count="documentCount = $event"
        />
        <AIChatView v-else-if="activeView === 'chat'" />
        <DailyAnalysis v-else-if="activeView === 'analysis'" :repo="activeRepo" />

        <template v-else>
          <InsightBanner :repo="activeRepo" @open="activeView = 'analysis'" />

          <section class="list-toolbar">
            <div class="list-toolbar__top">
              <div>
                <h2>{{ activeView === "pulls" ? "Pull Requests" : "Issues" }}</h2>
                <span>{{ filteredItems.length }} 条社区记录</span>
              </div>
              <div class="search-field">
                <Octicon name="search" :size="16" />
                <input
                  v-model="searchQuery"
                  type="search"
                  :placeholder="`搜索 ${activeKindLabel}…`"
                />
                <kbd>/</kbd>
              </div>
            </div>

            <div class="list-toolbar__filters">
              <div class="domain-chips" aria-label="技术领域筛选">
                <button
                  v-for="domain in domainOptions"
                  :key="domain"
                  :class="{ 'domain-chip--active': selectedDomain === domain }"
                  class="domain-chip"
                  @click="selectedDomain = domain"
                >
                  {{ domain }}
                </button>
              </div>

              <label class="state-filter">
                <Octicon name="filter" :size="14" />
                <select v-model="stateFilter">
                  <option>全部状态</option>
                  <option>开放中</option>
                  <option v-if="activeView === 'pulls'">已合入</option>
                  <option>已关闭</option>
                </select>
                <Octicon name="chevron-down" :size="13" />
              </label>
            </div>
          </section>

          <CommunityList
            :items="filteredItems"
            :loading="listLoading"
            :kind-label="activeKindLabel"
            :watched-keys="watchedKeys"
            @select="selectCommunityItem"
            @toggle="toggleWatch"
            @clear="clearFilters"
          />
        </template>
      </div>
    </main>

    <DetailDrawer
      v-if="selectedItem"
      :item="selectedItem"
      :watched="watchedKeys.has(communityItemKey(selectedItem))"
      :analysis-md="detailAnalysis?.contentMd"
      :analyzing="detailAnalyzing"
      @toggle-watch="toggleWatch"
      @analyze="analyzeSelectedItem"
      @close="selectedItem = null"
    />

    <AIChatDock />

    <Transition name="toast">
      <div v-if="toast" class="toast-message">
        <Octicon name="check-circle-fill" :size="16" />
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>
