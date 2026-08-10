<script setup lang="ts">
import type { RepositoryId } from "../types/core";
import type { TodaySummary } from "../types/community";
import Octicon from "./Octicon.vue";

defineProps<{
  repo: RepositoryId;
  summary?: TodaySummary | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  open: [];
}>();
</script>

<template>
  <section class="insight-banner">
    <div class="insight-banner__lead">
      <span class="ai-icon">
        <Octicon name="copilot" :size="20" />
      </span>
      <div>
        <div class="insight-banner__label">
          今日事件速览
          <span>{{ summary?.date.slice(5).replace("-", ".") || "北京时间" }}</span>
        </div>
        <p v-if="loading">正在读取北京时间今日事件…</p>
        <p v-else>{{ summary?.headline || `${repo} 尚未生成今日事件摘要。` }}</p>
      </div>
    </div>

    <div class="insight-banner__signals">
      <div>
        <strong>{{ summary?.importantChanges ?? 0 }}</strong>
        <span>重要变化</span>
      </div>
      <div>
        <strong>{{ summary?.riskCount ?? 0 }}</strong>
        <span>需关注风险</span>
      </div>
    </div>

    <button class="button button--ghost" @click="emit('open')">
      查看完整分析
      <Octicon name="arrow-right" :size="15" />
    </button>
  </section>
</template>
