<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { communityApi } from "../api/community";
import { ApiError } from "../api/core";
import type {
  AdaptationStatus,
  ImpactLevel,
} from "../types/core";
import type { CrossRepoImpact } from "../types/community";
import Octicon from "./Octicon.vue";

const emit = defineEmits<{ "update:count": [count: number] }>();
const activeFilter = ref("全部");
const filters = ["全部", "高风险", "待确认", "需适配"];
const impacts = ref<CrossRepoImpact[]>([]);
const loading = ref(true);
const error = ref("");
const updatingId = ref("");

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
  impacts.value.filter((impact) => {
    if (activeFilter.value === "高风险") return ["high", "critical"].includes(impact.level);
    if (activeFilter.value === "待确认") {
      return ["unreviewed", "possibly_affected"].includes(impact.status);
    }
    if (activeFilter.value === "需适配") return impact.status === "needs_adaptation";
    return true;
  }),
);

const highRiskCount = computed(
  () => impacts.value.filter((item) => ["high", "critical"].includes(item.level)).length,
);

async function loadImpacts() {
  loading.value = true;
  error.value = "";
  try {
    impacts.value = await communityApi.impacts();
    emit("update:count", impacts.value.length);
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "跨仓库影响加载失败";
  } finally {
    loading.value = false;
  }
}

async function updateStatus(impact: CrossRepoImpact, status: AdaptationStatus) {
  updatingId.value = impact.id;
  error.value = "";
  try {
    await communityApi.updateImpactStatus(impact.id, status);
    impact.status = status;
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "影响状态更新失败";
  } finally {
    updatingId.value = "";
  }
}

function relatedLabel(impact: CrossRepoImpact) {
  if (!impact.relatedItem) return "";
  if (typeof impact.relatedItem === "string") return impact.relatedItem;
  return `${impact.relatedItem.repo} #${impact.relatedItem.number} ${impact.relatedItem.title}`;
}

onMounted(loadImpacts);
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
        <div><strong>{{ impacts.length }}</strong><span>影响关系</span></div>
        <div><strong>{{ highRiskCount }}</strong><span>高风险</span></div>
      </div>
    </header>

    <div class="impact-summary">
      <span class="impact-summary__icon"><Octicon name="git-compare" :size="20" /></span>
      <div>
        <strong>先用文件与领域规则判断，再由人工确认</strong>
        <p>AI 只解释影响原因，不会自动把关系标记为“已适配”或“不适用”。</p>
      </div>
      <span>{{ impacts.length }} 条真实规则命中</span>
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

    <p v-if="error" class="inline-error">{{ error }}</p>
    <div v-if="loading" class="docs-loading">
      <span class="skeleton skeleton--title" />
      <span class="skeleton skeleton--summary" />
    </div>
    <div v-else-if="filteredImpacts.length" class="impact-list">
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
          <label class="adaptation-status" :data-status="impact.status">
            <span class="sr-only">人工确认状态</span>
            <select
              :value="impact.status"
              :disabled="updatingId === impact.id"
              @change="
                updateStatus(
                  impact,
                  ($event.target as HTMLSelectElement).value as AdaptationStatus,
                )
              "
            >
              <option
                v-for="(label, value) in statusLabels"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select>
          </label>
        </div>

        <p class="impact-card__analysis">
          <span><Octicon name="git-compare" :size="13" /> 规则初判</span>
          {{ impact.analysis }}
        </p>

        <div class="impact-map">
          <div>
            <span>上游修改</span>
            <code v-for="path in impact.changedPaths" :key="path">{{ path }}</code>
            <small v-if="!impact.changedPaths.length">打开 PR 详情读取文件统计后补充</small>
          </div>
          <Octicon name="arrow-right" :size="18" class="impact-map__arrow" />
          <div>
            <span>Ascend 对应区域</span>
            <code v-for="path in impact.ascendPaths" :key="path">{{ path }}</code>
          </div>
        </div>

        <footer v-if="impact.relatedItem" class="impact-card__footer">
          <Octicon name="link" :size="13" />
          已发现关联事项：{{ relatedLabel(impact) }}
        </footer>
      </article>
    </div>
    <div v-else class="empty-state">
      <span class="empty-state__icon"><Octicon name="git-compare" :size="24" /></span>
      <h3>尚未生成真实跨仓库关系</h3>
      <p>分别同步 vLLM 与 vLLM-Ascend 后，系统会基于领域和代码路径生成待确认关系。</p>
    </div>
  </section>
</template>
