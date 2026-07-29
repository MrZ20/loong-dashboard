<script setup lang="ts">
import { computed } from "vue";
import type { CommunityItem } from "../types";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  item: CommunityItem;
  watched: boolean;
}>();

const emit = defineEmits<{
  select: [item: CommunityItem];
  toggle: [item: CommunityItem];
}>();

const iconName = computed(() => {
  if (props.item.kind === "issue") {
    return props.item.state === "closed" ? "issue-closed" : "issue-opened";
  }

  if (props.item.state === "merged") return "git-merge";
  if (props.item.state === "closed") return "git-pull-request-closed";
  if (props.item.state === "draft") return "git-pull-request-draft";
  return "git-pull-request";
});

const stateClass = computed(() => `community-row__state--${props.item.state}`);
</script>

<template>
  <article
    class="community-row"
    tabindex="0"
    @click="emit('select', item)"
    @keydown.enter="emit('select', item)"
  >
    <span class="community-row__state" :class="stateClass">
      <Octicon :name="iconName" :size="20" />
    </span>

    <div class="community-row__content">
      <div class="community-row__title-line">
        <h3>{{ item.title }}</h3>
        <span v-if="item.important" class="important-marker">
          <Octicon name="flame" :size="13" />
          重要
        </span>
        <span class="domain-badge" :data-domain="item.domain">{{ item.domain }}</span>
      </div>

      <p class="community-row__meta">
        <span>#{{ item.id }}</span>
        <span>{{ item.state === "merged" ? "合入于" : "更新于" }} {{ item.time }}</span>
        <span>by {{ item.author }}</span>
        <span class="meta-divider">·</span>
        <span>{{ item.statusText }}</span>
      </p>

      <div class="community-row__summary">
        <span class="summary-label">
          <Octicon name="copilot" :size="13" />
          AI 摘要
        </span>
        <p>{{ item.summary }}</p>
      </div>
    </div>

    <div class="community-row__aside">
      <button
        class="icon-button community-row__watch"
        :class="{ 'community-row__watch--active': watched }"
        :aria-label="watched ? '取消关注' : '加入关注'"
        :title="watched ? '取消关注' : '加入关注'"
        @click.stop="emit('toggle', item)"
      >
        <Octicon :name="watched ? 'star-fill' : 'star'" :size="16" />
      </button>
      <span class="comment-count">
        <Octicon name="comment" :size="15" />
        {{ item.comments }}
      </span>
      <Octicon name="chevron-right" :size="18" />
    </div>
  </article>
</template>
