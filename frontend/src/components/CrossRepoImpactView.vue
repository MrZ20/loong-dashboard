<script setup lang="ts">
import { computed, ref } from "vue";
import { crossRepoImpacts } from "../data/workspace";
import type { AdaptationStatus, ImpactLevel } from "../types";
import Octicon from "./Octicon.vue";

const activeFilter = ref("全部");
const filters = ["全部", "高风险", "待确认", "需适配"];

const levelLabels: Record<ImpactLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

const statusLabels: Record<AdaptationStatus, string> = {
  unreviewed: "待确认",
  possibly_affected: "可能受影响",
  needs_adaptation: "需要适配",
  in_progress: "适配中",
  adapted: "已适配",
  not_applicable: "不适用",
};

const filteredImpacts = computed(() =>
  crossRepoImpacts.filter((impact) => {
    if (activeFilter.value === "高风险") return ["high", "critical"].includes(impact.level);
    if (activeFilter.value === "待确认") return impact.status === "unreviewed";
    if (activeFilter.value === "需适配") return impact.status === "needs_adaptation";
    return true;
  }),
);

const highRiskCount = computed(
  () => crossRepoImpacts.filter((item) => ["high", "critical"].includes(item.level)).length,
);
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">UPSTREAM ADAPTATION</span>
        <h2>跨仓库影响</h2>
        <p>跟踪 vLLM 上游变化对 vLLM-Ascend 适配层、扩展点与测试的潜在影响。</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ crossRepoImpacts.length }}</strong><span>影响关系</span></div>
        <div><strong>{{ highRiskCount }}</strong><span>高风险</span></div>
      </div>
    </header>

    <div class="impact-summary">
      <span class="impact-summary__icon"><Octicon name="git-compare" :size="20" /></span>
      <div>
        <strong>先用文件与领域规则判断，再由人工确认</strong>
        <p>AI 只解释影响原因，不会自动把关系标记为“已适配”或“不适用”。</p>
      </div>
      <span>4 条规则命中</span>
    </div>

    <div class="compact-filterbar">
      <div class="compact-filterbar__tabs" aria-label="影响等级筛选">
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
      <span>{{ filteredImpacts.length }} 项</span>
    </div>

    <div class="impact-list">
      <article v-for="impact in filteredImpacts" :key="impact.id" class="impact-card">
        <div class="impact-card__top">
          <span class="impact-level" :data-level="impact.level">
            {{ levelLabels[impact.level] }}
          </span>
          <div>
            <span class="impact-card__source">
              vllm {{ impact.source.kind === "pr" ? "PR" : "Issue" }} #{{ impact.source.number }}
            </span>
            <h3>{{ impact.source.title }}</h3>
          </div>
          <span class="domain-badge" :data-domain="impact.domain">{{ impact.domain }}</span>
          <span class="adaptation-status" :data-status="impact.status">
            {{ statusLabels[impact.status] }}
          </span>
        </div>

        <p class="impact-card__analysis">
          <span><Octicon name="copilot" :size="13" /> AI 影响判断</span>
          {{ impact.analysis }}
        </p>

        <div class="impact-map">
          <div>
            <span>上游修改</span>
            <code v-for="path in impact.changedPaths" :key="path">{{ path }}</code>
          </div>
          <Octicon name="arrow-right" :size="18" class="impact-map__arrow" />
          <div>
            <span>Ascend 对应区域</span>
            <code v-for="path in impact.ascendPaths" :key="path">{{ path }}</code>
          </div>
        </div>

        <footer v-if="impact.relatedItem" class="impact-card__footer">
          <Octicon name="link" :size="13" />
          已发现关联事项：{{ impact.relatedItem }}
        </footer>
      </article>
    </div>
  </section>
</template>
