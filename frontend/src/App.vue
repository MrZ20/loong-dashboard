<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref, watch } from "vue";
import { ApiError } from "./api/core";
import AIChatDock from "./components/AIChatDock.vue";
import AppSidebar from "./components/AppSidebar.vue";
import CommunityList from "./components/CommunityList.vue";
import DateRangeFilter from "./components/DateRangeFilter.vue";
import DetailDrawer from "./components/DetailDrawer.vue";
import FilterDropdown from "./components/FilterDropdown.vue";
import InsightBanner from "./components/InsightBanner.vue";
import LoginView from "./components/LoginView.vue";
import Octicon from "./components/Octicon.vue";
import RepositoryHeader from "./components/RepositoryHeader.vue";
import { useAIChat } from "./composables/useAIChat";
import { useAppPreferences } from "./composables/useAppPreferences";
import { useAuthSession } from "./composables/useAuthSession";
import { useCommunityDetail } from "./composables/useCommunityDetail";
import { useCommunityWorkspace } from "./composables/useCommunityWorkspace";
import { communityItemKey } from "./domain/community-item";
import type { AppView, RepositoryId } from "./types/core";
import type { CommunityItem } from "./types/community";
import type { PromptFeatureKey } from "./types/ai";
import type { RefreshTaskType } from "./types/refresh";
import type { UserAccount } from "./types/account";

const AIChatView = defineAsyncComponent(() => import("./components/AIChatView.vue"));
const AIInsightsView = defineAsyncComponent(() => import("./components/AIInsightsView.vue"));
const CrossRepoImpactView = defineAsyncComponent(() => import("./components/CrossRepoImpactView.vue"));
const DailyAnalysis = defineAsyncComponent(() => import("./components/DailyAnalysis.vue"));
const DomainMapView = defineAsyncComponent(() => import("./components/DomainMapView.vue"));
const SettingsView = defineAsyncComponent(() => import("./components/SettingsView.vue"));
const TechnicalDocsView = defineAsyncComponent(() => import("./components/TechnicalDocsView.vue"));
const WatchlistView = defineAsyncComponent(() => import("./components/WatchlistView.vue"));

const sidebarOpen = ref(false);
const toast = ref("");
const settingsPromptFeature = ref<PromptFeatureKey | null>(null);
const { setPageContext } = useAIChat();
const { sidebarCollapsed, theme } = useAppPreferences();

const {
  activeKindLabel,
  activeRepo,
  activeView,
  clearFilters,
  clearUserData,
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
  pageSize,
  refreshData: refreshWorkspaceData,
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
  toggleWatch: updateWatch,
  upsertCommunityItem,
  updatedFrom,
  updatedTo,
  watchedKeys,
  watchlistMeta,
  watchlistItems,
  workspaceHeader,
} = useCommunityWorkspace();

function showToast(message: string) {
  toast.value = message;
  window.setTimeout(() => {
    toast.value = "";
  }, 2_200);
}

const {
  analyzeSelectedItem,
  cancelDetailAnalysis,
  closeDetail,
  detailAnalysis,
  detailAnalyzing,
  detailDiffLoading,
  detailTaskLoading,
  detailLocalJob,
  detailLocalEvents,
  loadSelectedDiff,
  refreshSelectedItem,
  selectedItem,
  selectCommunityItem,
} = useCommunityDetail(showToast, upsertCommunityItem);

const {
  authError,
  authLoading,
  authMode,
  authUser,
  initializeAuth,
  login,
  loginLoading,
  logout,
  signInPath,
  signOutPath,
  updateCurrentUser: updateAuthUser,
} = useAuthSession({
  onAuthenticated: loadApplicationData,
  onLoggedOut: clearUserData,
});

watch([activeRepo, activeView], () => {
  closeDetail();
  sidebarOpen.value = false;
  if (
    activeView.value === "issues" &&
    ["Draft", "已合入"].includes(stateFilter.value)
  ) {
    stateFilter.value = "全部状态";
  }
});

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
  if (view === "settings") settingsPromptFeature.value = null;
  activeView.value = view;
}

function openPromptSettings(feature: PromptFeatureKey) {
  settingsPromptFeature.value = feature;
  activeView.value = "settings";
  closeDetail();
}

async function refreshData() {
  try {
    showToast(await refreshWorkspaceData());
  } catch (cause) {
    showToast(cause instanceof ApiError ? cause.message : "GitHub 同步失败");
  }
}

async function handleSettingsRefreshComplete(
  repoId: RepositoryId,
  taskType: RefreshTaskType,
) {
  try {
    await reloadCommunitySnapshot(repoId);
    if (taskType === "facts") {
      const repo = repositoryData.value.find((candidate) => candidate.id === repoId);
      showToast(
        `${repo?.name ?? repoId} 刷新完成：当前 ${repo?.openPulls ?? 0} 个 PR、${repo?.openIssues ?? 0} 个 Issue`,
      );
    }
  } catch (cause) {
    showToast(cause instanceof ApiError ? cause.message : "刷新结果加载失败");
  }
}

async function toggleWatch(item: CommunityItem) {
  try {
    const removing = await updateWatch(item);
    showToast(removing ? `已取消关注 #${item.id}` : `已加入关注 #${item.id}`);
  } catch (cause) {
    showToast(cause instanceof ApiError ? cause.message : "关注状态更新失败");
  }
}

function updateCurrentUser(profile: UserAccount) {
  if (updateAuthUser(profile)) showToast("账户资料已更新");
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

  <div
    v-else
    class="app-shell"
    :class="{ 'app-shell--sidebar-collapsed': sidebarCollapsed }"
    :data-theme="theme"
  >
    <AppSidebar
      :repositories="repositoryData"
      :active-repo="activeRepo"
      :active-view="activeView"
      :insight-count="insightCount"
      :watchlist-count="watchlistItems.length"
      :impact-count="impactCount"
      :document-count="documentCount"
      :focus-domain="todaySummaries[activeRepo]?.topDomain || '暂无'"
      :focus-count="todaySummaries[activeRepo]?.importantChanges || 0"
      :user-name="authUser.displayName"
      :user-email="authUser.email"
      :open="sidebarOpen"
      :collapsed="sidebarCollapsed"
      @update:repo="changeRepo"
      @update:view="changeView"
      @update:collapsed="sidebarCollapsed = $event"
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
        <AIInsightsView
          v-if="activeView === 'insights'"
          @manage-prompt="openPromptSettings"
        />
        <WatchlistView
          v-else-if="activeView === 'watchlist'"
          :items="watchlistItems"
          :meta-by-key="watchlistMeta"
          @select="selectCommunityItem"
          @toggle="toggleWatch"
        />
        <CrossRepoImpactView
          v-else-if="activeView === 'impact'"
          @update:count="impactCount = $event"
        />
        <DomainMapView
          v-else-if="activeView === 'domains'"
          @manage-prompt="openPromptSettings"
        />
        <TechnicalDocsView
          v-else-if="activeView === 'docs'"
          @update:count="documentCount = $event"
          @manage-prompt="openPromptSettings"
        />
        <AIChatView
          v-else-if="activeView === 'chat'"
          @manage-prompt="openPromptSettings"
        />
        <SettingsView
          v-else-if="activeView === 'settings'"
          :initial-tab="settingsPromptFeature ? 'management' : undefined"
          :initial-prompt-feature="settingsPromptFeature || undefined"
          :initial-repo="activeRepo"
          @update:user="updateCurrentUser"
          @refresh-complete="handleSettingsRefreshComplete"
        />
        <DailyAnalysis
          v-else-if="activeView === 'analysis'"
          :repo="activeRepo"
          @manage-prompt="openPromptSettings"
        />

        <template v-else>
          <InsightBanner
            :repo="activeRepo"
            :summary="todaySummaries[activeRepo]"
            :loading="todayLoading"
            @open="activeView = 'analysis'"
          />

          <section class="list-toolbar">
            <div class="list-toolbar__top">
              <div>
                <h2>{{ activeView === "pulls" ? "Pull Requests" : "Issues" }}</h2>
                <span>{{ communityTotal }} 条社区记录</span>
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
              <div class="filter-toolbar__intro">
                <span class="filter-toolbar__intro-icon">
                  <Octicon name="filter" :size="14" />
                </span>
                <span>
                  <strong>筛选社区动态</strong>
                  <small>按更新时间、技术领域、状态和排序方式查看</small>
                </span>
              </div>

              <div class="filter-toolbar__controls">
                <DateRangeFilter
                  v-model:from="updatedFrom"
                  v-model:to="updatedTo"
                />
                <FilterDropdown
                  v-model="selectedDomain"
                  class="filter-dropdown--domain"
                  label="技术领域"
                  icon="stack"
                  :options="domainFilterOptions"
                />
                <FilterDropdown
                  v-model="stateFilter"
                  class="filter-dropdown--state"
                  label="当前状态"
                  icon="filter"
                  align="right"
                  :options="stateFilterOptions"
                />
                <FilterDropdown
                  v-model="sortMode"
                  class="filter-dropdown--sort"
                  label="排序方式"
                  icon="sort-desc"
                  align="right"
                  :options="sortOptions"
                />
              </div>
            </div>
          </section>

          <CommunityList
            :items="paginatedItems"
            :loading="listLoading"
            :kind-label="activeKindLabel"
            :watched-keys="watchedKeys"
            :current-page="pagination.currentPage"
            :total-items="communityTotal"
            :total-pages="pagination.totalPages"
            :page-size="pageSize"
            @select="selectCommunityItem"
            @toggle="toggleWatch"
            @clear="clearFilters"
            @page="currentPage = $event"
          />
        </template>
      </div>
    </main>

    <DetailDrawer
      v-if="selectedItem"
      :item="selectedItem"
      :watched="watchedKeys.has(communityItemKey(selectedItem))"
      :analysis="detailAnalysis"
      :analyzing="detailAnalyzing"
      :diff-loading="detailDiffLoading"
      :task-loading="detailTaskLoading"
      :local-job="detailLocalJob"
      :local-events="detailLocalEvents"
      @toggle-watch="toggleWatch"
      @analyze="analyzeSelectedItem"
      @cancel-analysis="cancelDetailAnalysis"
      @manage-prompt="openPromptSettings"
      @load-diff="loadSelectedDiff"
      @refresh-facts="refreshSelectedItem($event, 'facts')"
      @update-summary="refreshSelectedItem($event, 'summary')"
      @reclassify="refreshSelectedItem($event, 'classification')"
      @close="closeDetail"
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
