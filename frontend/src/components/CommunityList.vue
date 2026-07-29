<script setup lang="ts">
import type { CommunityItem } from "../types";
import { communityItemKey } from "../data/workspace";
import CommunityRow from "./CommunityRow.vue";
import Octicon from "./Octicon.vue";

defineProps<{
  items: CommunityItem[];
  loading: boolean;
  kindLabel: string;
  watchedKeys: Set<string>;
}>();

const emit = defineEmits<{
  select: [item: CommunityItem];
  toggle: [item: CommunityItem];
  clear: [];
}>();
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
        v-for="item in items"
        :key="`${item.repo}-${item.kind}-${item.id}`"
        :item="item"
        :watched="watchedKeys.has(communityItemKey(item))"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
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
