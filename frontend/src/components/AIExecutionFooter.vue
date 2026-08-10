<script setup lang="ts">
import { computed } from "vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  engine?: string | null;
  provider?: string | null;
  model?: string | null;
  promptName?: string | null;
  promptVersion?: string | null;
  promptRevision?: number | null;
}>();

const visible = computed(() => Boolean(
  props.engine || props.provider || props.model || props.promptName || props.promptVersion,
));
</script>

<template>
  <footer v-if="visible" class="ai-execution-footer">
    <span class="ai-execution-footer__title">
      <Octicon name="cpu" :size="13" />本次 AI 执行
    </span>
    <span v-if="engine"><small>方式</small>{{ engine }}</span>
    <span v-if="provider"><small>配置</small>{{ provider }}</span>
    <span v-if="model"><small>模型</small>{{ model }}</span>
    <span v-if="promptName || promptVersion">
      <small>提示词</small>{{ promptName || promptVersion }}<template v-if="promptVersion && promptName"> · {{ promptVersion }}</template><template v-if="promptRevision"> · r{{ promptRevision }}</template>
    </span>
  </footer>
</template>

<style scoped>
.ai-execution-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  margin-top: 14px;
  padding-top: 11px;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 10px;
}

.ai-execution-footer > span {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-muted);
}

.ai-execution-footer small {
  color: var(--text-tertiary);
  font-size: 9px;
}

.ai-execution-footer__title {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border)) !important;
  background: var(--accent-soft) !important;
  color: var(--accent-dark);
  font-weight: 700;
}
</style>
