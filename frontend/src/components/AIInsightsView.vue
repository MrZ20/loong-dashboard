<script setup lang="ts">
import AnalysisDocumentWorkspace from "./AnalysisDocumentWorkspace.vue";
</script>

<template>
  <AnalysisDocumentWorkspace
    type="insight"
    scope="all"
    title="AI 洞察"
    eyebrow="CROSS-REPOSITORY INTELLIGENCE"
    description="将跨仓库信号生成一份包含证据、风险、不确定性与建议动作的完整 Markdown 洞察文档。"
    default-prompt="综合分析 vLLM 与 vLLM-Ascend 的 PR、Issue、关注列表、跨仓库影响和技术领域变化。识别重大事件、潜在回归、上游适配风险、技术趋势与协作窗口；所有判断都引用证据，并给出下一步动作。"
  />
</template>
