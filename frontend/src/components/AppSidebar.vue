<script setup lang="ts">
import { ref, watch } from "vue";
import type { AppTab, AppView, RepositoryId, RepositoryMeta } from "../types";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  repositories: RepositoryMeta[];
  activeRepo: RepositoryId;
  activeView: AppView;
  insightCount: number;
  watchlistCount: number;
  impactCount: number;
  documentCount: number;
  userName: string;
  userEmail: string;
  open: boolean;
}>();

const emit = defineEmits<{
  "update:repo": [value: RepositoryId];
  "update:view": [value: AppView];
  logout: [];
  close: [];
}>();

const expandedRepos = ref<RepositoryId[]>([props.activeRepo]);

const repositoryNavigation: Array<{
  id: AppTab;
  label: string;
  icon: string;
}> = [
  { id: "pulls", label: "Pull Requests", icon: "git-pull-request" },
  { id: "issues", label: "Issues", icon: "issue-opened" },
  { id: "analysis", label: "今日分析", icon: "pulse" },
];

const workspaceNavigation: Array<{
  id: Exclude<AppView, AppTab>;
  label: string;
  icon: string;
}> = [
  { id: "insights", label: "AI 洞察", icon: "sparkle-fill" },
  { id: "watchlist", label: "关注列表", icon: "star" },
  { id: "impact", label: "跨仓库影响", icon: "git-compare" },
  { id: "domains", label: "技术领域地图", icon: "stack" },
  { id: "docs", label: "技术文档", icon: "book" },
  { id: "chat", label: "AI 对话", icon: "comment-discussion" },
];

watch(
  () => props.activeRepo,
  (repo) => {
    if (!expandedRepos.value.includes(repo)) {
      expandedRepos.value.push(repo);
    }
  },
);

function isExpanded(repo: RepositoryId) {
  return expandedRepos.value.includes(repo);
}

function toggleRepository(repo: RepositoryId) {
  if (props.activeRepo !== repo) {
    emit("update:repo", repo);
    if (!isExpanded(repo)) expandedRepos.value.push(repo);
    return;
  }

  expandedRepos.value = isExpanded(repo)
    ? expandedRepos.value.filter((item) => item !== repo)
    : [...expandedRepos.value, repo];
}

function selectRepositoryTab(repo: RepositoryId, tab: AppTab) {
  if (props.activeRepo !== repo) emit("update:repo", repo);
  emit("update:view", tab);
  emit("close");
}

function selectWorkspace(view: Exclude<AppView, AppTab>) {
  emit("update:view", view);
  emit("close");
}

function workspaceCount(view: Exclude<AppView, AppTab>) {
  if (view === "insights") return props.insightCount;
  if (view === "watchlist") return props.watchlistCount;
  if (view === "impact") return props.impactCount;
  if (view === "docs") return props.documentCount;
  if (view === "chat") return "AI";
  return 6;
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--open': open }">
    <div class="sidebar__brand">
      <span class="sidebar__mark">
        <Octicon name="telescope" :size="20" />
      </span>
      <div>
        <strong>LoongBoard</strong>
        <span>Community intelligence</span>
      </div>
      <button class="sidebar__close icon-button" aria-label="关闭导航" @click="emit('close')">
        <Octicon name="x" :size="18" />
      </button>
    </div>

    <nav class="sidebar__nav" aria-label="工作台与仓库导航">
      <p class="sidebar__eyebrow">工作台</p>
      <div class="sidebar-workspace">
        <button
          v-for="item in workspaceNavigation"
          :key="item.id"
          class="sidebar-workspace__item"
          :class="{ 'sidebar-workspace__item--active': activeView === item.id }"
          @click="selectWorkspace(item.id)"
        >
          <Octicon :name="item.icon" :size="16" />
          <span>{{ item.label }}</span>
          <span class="sidebar-workspace__count">{{ workspaceCount(item.id) }}</span>
        </button>
      </div>

      <p class="sidebar__eyebrow sidebar__eyebrow--repos">社区仓库</p>

      <section
        v-for="repo in repositories"
        :key="repo.id"
        class="repo-group"
        :class="{
          'repo-group--active': activeRepo === repo.id,
          'repo-group--expanded': isExpanded(repo.id),
        }"
      >
        <button
          class="repo-switcher"
          :aria-expanded="isExpanded(repo.id)"
          @click="toggleRepository(repo.id)"
        >
          <span class="repo-switcher__icon">
            <Octicon name="repo" :size="17" />
          </span>
          <span class="repo-switcher__copy">
            <strong>{{ repo.name }}</strong>
            <small>{{ repo.openPulls }} PR · {{ repo.openIssues }} Issue</small>
          </span>
          <Octicon
            name="chevron-right"
            :size="14"
            class="repo-switcher__chevron"
          />
        </button>

        <div v-if="isExpanded(repo.id)" class="repo-subnav">
          <button
            v-for="item in repositoryNavigation"
            :key="item.id"
            class="repo-subnav__item"
            :class="{
              'repo-subnav__item--active':
                activeRepo === repo.id && activeView === item.id,
            }"
            @click="selectRepositoryTab(repo.id, item.id)"
          >
            <Octicon :name="item.icon" :size="15" />
            <span>{{ item.label }}</span>
            <span v-if="item.id === 'pulls'" class="repo-subnav__count">
              {{ repo.openPulls }}
            </span>
            <span v-else-if="item.id === 'issues'" class="repo-subnav__count">
              {{ repo.openIssues }}
            </span>
            <span v-else class="repo-subnav__ai">AI</span>
          </button>
        </div>
      </section>
    </nav>

    <button class="sidebar__focus" @click="selectWorkspace('domains')">
      <span class="sidebar__focus-icon">
        <Octicon name="light-bulb" :size="16" />
      </span>
      <div>
        <span>今日关注领域</span>
        <strong>FusedMoE</strong>
      </div>
      <span class="sidebar__focus-count">8</span>
    </button>

    <div class="sidebar__account">
      <span>{{ userName.slice(0, 1).toUpperCase() }}</span>
      <div><strong>{{ userName }}</strong><small>{{ userEmail }}</small></div>
      <button class="icon-button" aria-label="退出登录" title="退出登录" @click="emit('logout')">
        <Octicon name="sign-out" :size="15" />
      </button>
    </div>

    <div class="sidebar__footer">
      <button class="sidebar__footer-button">
        <Octicon name="gear" :size="16" />
        <span>分析配置</span>
      </button>
      <span class="prototype-chip">原型数据</span>
    </div>
  </aside>
</template>
