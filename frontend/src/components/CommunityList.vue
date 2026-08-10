<script setup lang="ts">
import { computed } from "vue";
import type { CommunityItem } from "../types/community";
import { communityItemKey } from "../domain/community-item";
import CommunityRow from "./CommunityRow.vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  items: CommunityItem[];
  loading: boolean;
  kindLabel: string;
  watchedKeys: Set<string>;
  currentPage: number;
  totalItems: number;
  totalPages: number;
  pageSize: number;
}>();

const emit = defineEmits<{
  select: [item: CommunityItem];
  toggle: [item: CommunityItem];
  clear: [];
  page: [page: number];
}>();

const visiblePages = computed(() => {
  const windowSize = 5;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, props.currentPage - half);
  const end = Math.min(props.totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});

function setPage(page: number) {
  if (page < 1 || page > props.totalPages || page === props.currentPage) return;
  emit("page", page);
}
</script>

<template>
  <div class="community-list">
    <div v-if="loading" class="list-loading" aria-live="polite">
      <span v-for="index in 4" :key="index" class="skeleton-row">
        <span class="skeleton skeleton--icon" />
        <span class="skeleton-row__body">
          <span class="skeleton skeleton--title" />
          <span class="skeleton skeleton--meta" />
          <span class="skeleton skeleton--summary" />
        </span>
      </span>
    </div>

    <template v-else-if="items.length">
      <CommunityRow
        v-for="(item, index) in items"
        :key="`${item.repo}-${item.kind}-${item.id}`"
        :item="item"
        :page-index="(currentPage - 1) * pageSize + index + 1"
        :watched="watchedKeys.has(communityItemKey(item))"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
      <nav v-if="totalPages > 1" class="community-pagination" aria-label="社区列表分页">
        <span class="community-pagination__summary">
          第 {{ (currentPage - 1) * pageSize + 1 }}–{{ Math.min(currentPage * pageSize, totalItems) }} 条，共 {{ totalItems }} 条
        </span>
        <div class="community-pagination__controls">
          <button
            class="community-pagination__button community-pagination__button--wide"
            :disabled="currentPage === 1"
            aria-label="上一页"
            @click="setPage(currentPage - 1)"
          ><Octicon name="chevron-left" :size="14" />上一页</button>
          <button
            v-for="page in visiblePages"
            :key="page"
            class="community-pagination__button"
            :class="{ 'community-pagination__button--active': page === currentPage }"
            :aria-current="page === currentPage ? 'page' : undefined"
            :aria-label="`第 ${page} 页`"
            @click="setPage(page)"
          >{{ page }}</button>
          <button
            class="community-pagination__button community-pagination__button--wide"
            :disabled="currentPage === totalPages"
            aria-label="下一页"
            @click="setPage(currentPage + 1)"
          >下一页<Octicon name="chevron-right" :size="14" /></button>
        </div>
      </nav>
    </template>

    <div v-else class="empty-state">
      <span class="empty-state__icon">
        <Octicon name="search" :size="24" />
      </span>
      <h3>没有符合条件的{{ kindLabel }}</h3>
      <p>试试清除搜索词或切换技术领域。</p>
      <button class="button button--secondary" @click="emit('clear')">清除筛选</button>
    </div>
  </div>
</template>
