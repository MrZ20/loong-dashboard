<script setup lang="ts">
import AnalysisDocumentWorkspace from "./AnalysisDocumentWorkspace.vue";
import type { PromptFeatureKey } from "../types/ai";

const emit = defineEmits<{
  "manage-prompt": [feature: PromptFeatureKey];
}>();
</script>

<template>
  <AnalysisDocumentWorkspace
    type="insight"
    scope="all"
    title="AI 洞察"
    eyebrow="CROSS-REPOSITORY INTELLIGENCE"
    feature-key="cross_repo_insight"
    description="将跨仓库信号生成一份包含证据、风险、不确定性与建议动作的完整 Markdown 洞察文档。"
    @manage-prompt="emit('manage-prompt', $event)"
  />
</template>
