<script setup lang="ts">
import type { RepositoryId } from "../types/core";
import AnalysisDocumentWorkspace from "./AnalysisDocumentWorkspace.vue";
import type { PromptFeatureKey } from "../types/ai";

defineProps<{
  repo: RepositoryId;
}>();

const emit = defineEmits<{
  "manage-prompt": [feature: PromptFeatureKey];
}>();
</script>

<template>
  <AnalysisDocumentWorkspace
    type="daily"
    :scope="repo"
    title="今日分析"
    eyebrow="DAILY COMMUNITY BRIEF"
    feature-key="daily_report"
    :description="`针对 ${repo} 北京时间当前自然日的状态事件生成完整 Markdown 社区日报。`"
    @manage-prompt="emit('manage-prompt', $event)"
  />
</template>
