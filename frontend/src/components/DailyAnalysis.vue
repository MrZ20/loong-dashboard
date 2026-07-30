<script setup lang="ts">
import type { RepositoryId } from "../types";
import AnalysisDocumentWorkspace from "./AnalysisDocumentWorkspace.vue";

defineProps<{
  repo: RepositoryId;
}>();
</script>

<template>
  <AnalysisDocumentWorkspace
    type="daily"
    :scope="repo"
    title="今日分析"
    eyebrow="DAILY COMMUNITY BRIEF"
    :description="`针对 ${repo} 北京时间当前自然日的状态事件生成完整 Markdown 社区日报。`"
    default-prompt="分析北京时间当前自然日内的 PR 与 Issue 状态事件，区分新建、更新、Draft、Ready、合入、关闭和重新打开；重点识别社区重大事件、重要代码改动、技术趋势、潜在回归，以及可能影响 vLLM-Ascend 的上游变化。按优先级给出今日建议，并引用证据。"
  />
</template>
