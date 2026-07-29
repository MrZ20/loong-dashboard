<script setup lang="ts">
import { computed, ref } from "vue";
import { communityItemKey, watchlistMeta } from "../data/workspace";
import type { CommunityItem, WatchlistMeta } from "../types";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  items: CommunityItem[];
}>();

const emit = defineEmits<{
  select: [item: CommunityItem];
  toggle: [item: CommunityItem];
}>();

const activeFilter = ref("全部");
const filters = ["全部", "P0 / P1", "本日检查", "上游影响"];

const fallbackMeta: WatchlistMeta = {
  reason: "持续关注",
  note: "尚未添加个人备注。",
  priority: "P2",
  nextCheck: "明天",
};

function metaFor(item: CommunityItem) {
  return watchlistMeta[communityItemKey(item)] ?? fallbackMeta;
}

const filteredItems = computed(() =>
  props.items.filter((item) => {
    const meta = metaFor(item);
    if (activeFilter.value === "P0 / P1") return ["P0", "P1"].includes(meta.priority);
    if (activeFilter.value === "本日检查") return meta.nextCheck.includes("今天");
    if (activeFilter.value === "上游影响") {
      return item.repo === "vllm" || meta.reason.includes("Ascend");
    }
    return true;
  }),
);

const urgentCount = computed(
  () => props.items.filter((item) => ["P0", "P1"].includes(metaFor(item).priority)).length,
);
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">PERSONAL SIGNALS</span>
        <h2>关注列表</h2>
        <p>保存需要持续跟进、但暂未转成正式任务的社区事项。</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ items.length }}</strong><span>关注事项</span></div>
        <div><strong>{{ urgentCount }}</strong><span>高优先级</span></div>
      </div>
    </header>

    <div class="compact-filterbar">
      <div class="compact-filterbar__tabs" aria-label="关注列表筛选">
        <button
          v-for="filter in filters"
          :key="filter"
          class="compact-filterbar__tab"
          :class="{ 'compact-filterbar__tab--active': activeFilter === filter }"
          @click="activeFilter = filter"
        >
          {{ filter }}
        </button>
      </div>
      <span>{{ filteredItems.length }} 项</span>
    </div>

    <div class="watchlist-panel">
      <article
        v-for="item in filteredItems"
        :key="communityItemKey(item)"
        class="watchlist-row"
        tabindex="0"
        @click="emit('select', item)"
        @keydown.enter="emit('select', item)"
      >
        <span class="watchlist-row__priority" :data-priority="metaFor(item).priority">
          {{ metaFor(item).priority }}
        </span>
        <div class="watchlist-row__body">
          <div class="watchlist-row__title">
            <span>{{ item.repo }}</span>
            <strong>#{{ item.id }} {{ item.title }}</strong>
            <span class="domain-badge" :data-domain="item.domain">{{ item.domain }}</span>
          </div>
          <p class="watchlist-row__reason">
            <Octicon name="pulse" :size="13" />
            {{ metaFor(item).reason }}
            <span>·</span>
            {{ item.statusText }}
          </p>
          <p class="watchlist-row__note">{{ metaFor(item).note }}</p>
        </div>
        <div class="watchlist-row__aside">
          <span>
            <Octicon name="clock" :size="13" />
            {{ metaFor(item).nextCheck }}
          </span>
          <button
            class="icon-button watchlist-row__star"
            aria-label="取消关注"
            title="取消关注"
            @click.stop="emit('toggle', item)"
          >
            <Octicon name="star-fill" :size="17" />
          </button>
        </div>
      </article>

      <div v-if="!filteredItems.length" class="empty-state">
        <span class="empty-state__icon"><Octicon name="star" :size="24" /></span>
        <h3>当前筛选下没有关注事项</h3>
        <p>可以从 PR 或 Issue 列表中点击星标加入关注。</p>
      </div>
    </div>
  </section>
</template>
