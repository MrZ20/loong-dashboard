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
const summaryLabel = computed(() =>
  props.item.summarySource === "ai" ? "AI 摘要" : "正文摘录",
);
const effectiveStatus = computed(() => {
  if (props.item.lastEventType === "reopened") return "Reopened";
  if (props.item.lastEventType === "ready_for_review") return "Ready for review";
  return props.item.statusText;
});
const reviewIcon = computed(() => {
  const action = props.item.reviewSignal?.action;
  if (action === "ready") return "check-circle";
  if (action === "attention") return "alert";
  if (action === "blocked") return "x-circle";
  if (action === "waiting") return "clock";
  return "info";
});
const ciLabel = computed(() => {
  const status = props.item.reviewSignal?.ciStatus;
  if (status === "success") return "CI 通过";
  if (status === "failure") return "CI 失败";
  if (status === "pending") return "CI 运行中";
  return "";
});
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
        <span
          v-if="item.kind === 'pr' && item.reviewSignal"
          class="review-signal-badge"
          :data-action="item.reviewSignal.action"
          :title="item.reviewSignal.summary"
        >
          <Octicon :name="reviewIcon" :size="12" />
          {{ item.reviewSignal.label }}
        </span>
      </div>

      <p class="community-row__meta">
        <span>#{{ item.id }}</span>
        <span>{{ item.state === "merged" ? "合入于" : "更新于" }} {{ item.time }}</span>
        <span>by {{ item.author }}</span>
        <span class="meta-divider">·</span>
        <span>{{ effectiveStatus }}</span>
        <template v-if="item.kind === 'pr' && item.reviewSignal">
          <span v-if="ciLabel" class="meta-divider">·</span>
          <span
            v-if="ciLabel"
            class="review-meta"
            :data-status="item.reviewSignal.ciStatus"
          >{{ ciLabel }}</span>
          <span
            v-if="item.reviewSignal.mergeability === 'conflicting'"
            class="review-meta"
            data-status="failure"
          >· 存在冲突</span>
          <span v-else-if="item.reviewSignal.mergeability === 'mergeable'" class="review-meta">
            · 可合并
          </span>
          <span v-if="item.reviewSignal.behindBy && item.reviewSignal.behindBy > 0" class="review-meta">
            · 落后 {{ item.reviewSignal.behindBy }} commits
          </span>
        </template>
      </p>

      <div class="community-row__summary">
        <span class="summary-label">
          <Octicon name="copilot" :size="13" />
          {{ summaryLabel }}
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
