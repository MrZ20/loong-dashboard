<script setup lang="ts">
import { computed } from "vue";
import type { RepositoryMeta, ThemeMode } from "../types";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  repo: RepositoryMeta;
  refreshing: boolean;
  theme: ThemeMode;
  context?: {
    owner: string;
    title: string;
    icon: string;
    badge: string;
  } | null;
}>();

const syncedLabel = computed(() => {
  if (!props.repo.lastSyncedAt) return "尚未同步";
  const elapsed = Math.max(
    0,
    Date.now() - new Date(props.repo.lastSyncedAt).valueOf(),
  );
  if (elapsed < 60_000) return "刚刚同步";
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)} 分钟前同步`;
  if (elapsed < 86_400_000) return `${Math.round(elapsed / 3_600_000)} 小时前同步`;
  return `${Math.round(elapsed / 86_400_000)} 天前同步`;
});

const emit = defineEmits<{
  refresh: [];
  "open-menu": [];
  "update:theme": [value: ThemeMode];
}>();
</script>

<template>
  <header class="repo-header">
    <div class="repo-header__top">
      <button class="repo-header__menu icon-button" aria-label="打开导航" @click="emit('open-menu')">
        <Octicon name="three-bars" :size="20" />
      </button>
      <div class="repo-header__identity">
        <span class="repo-header__repo-icon">
          <Octicon :name="context?.icon ?? 'repo'" :size="22" />
        </span>
        <div>
          <div class="repo-header__owner">{{ context?.owner ?? repo.owner }} /</div>
          <h1>{{ context?.title ?? repo.name }}</h1>
        </div>
        <span class="public-chip">{{ context?.badge ?? "Public" }}</span>
      </div>

      <div class="repo-header__actions">
        <div class="theme-toggle" aria-label="界面主题">
          <button
            aria-label="切换为白天模式"
            :aria-pressed="theme === 'light'"
            :class="{ 'theme-toggle__item--active': theme === 'light' }"
            class="theme-toggle__item"
            @click="emit('update:theme', 'light')"
          >
            <Octicon name="sun" :size="15" />
          </button>
          <button
            aria-label="切换为黑夜模式"
            :aria-pressed="theme === 'dark'"
            :class="{ 'theme-toggle__item--active': theme === 'dark' }"
            class="theme-toggle__item"
            @click="emit('update:theme', 'dark')"
          >
            <Octicon name="moon" :size="14" />
          </button>
        </div>
        <span class="updated-time">
          <span class="status-dot" />
          {{ syncedLabel }}
        </span>
        <button class="button button--secondary" :disabled="refreshing" @click="emit('refresh')">
          <Octicon name="sync" :size="15" :class="{ spinning: refreshing }" />
          {{ refreshing ? "同步中" : `同步 ${repo.name}` }}
        </button>
      </div>
    </div>
  </header>
</template>
