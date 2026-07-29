<script setup lang="ts">
import type { RepositoryId } from "../types";
import Octicon from "./Octicon.vue";

defineProps<{
  repo: RepositoryId;
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
          AI 今日速览
          <span>07.30</span>
        </div>
        <p v-if="repo === 'vllm-ascend'">
          FusedMoE 与 MRV2 是今日变化中心；1 项性能回归需要优先跟进，另有 2 个上游改动可能影响 Ascend 适配。
        </p>
        <p v-else>
          调度器公平性与设备能力注册是今日重点；2 个上游架构变化值得 Ascend 侧提前评估。
        </p>
      </div>
    </div>

    <div class="insight-banner__signals">
      <div>
        <strong>3</strong>
        <span>重要变化</span>
      </div>
      <div>
        <strong>2</strong>
        <span>需关注风险</span>
      </div>
    </div>

    <button class="button button--ghost" @click="emit('open')">
      查看完整分析
      <Octicon name="arrow-right" :size="15" />
    </button>
  </section>
</template>
