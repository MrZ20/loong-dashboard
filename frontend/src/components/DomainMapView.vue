<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { contentApi } from "../api/content";
import { ApiError } from "../api/core";
import { localAnalysisApi } from "../api/local-analysis";
import type { DomainMapApi } from "../types/content";
import type { LocalAnalysisEvent, LocalAnalysisJob } from "../types/analysis";
import type { PromptFeatureKey } from "../types/ai";
import AIExecutionFooter from "./AIExecutionFooter.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const domains = ref<DomainMapApi[]>([]);
const selectedId = ref("");
const loading = ref(true);
const snapshotting = ref(false);
const error = ref("");
const localJob = ref<LocalAnalysisJob | null>(null);
const localEvents = ref<LocalAnalysisEvent[]>([]);
let localJobTimer: number | null = null;
const emit = defineEmits<{
  "manage-prompt": [feature: PromptFeatureKey];
}>();

const selectedDomain = computed(
  () =>
    domains.value.find((domain) => domain.id === selectedId.value) ??
    domains.value[0] ??
    null,
);
const heatingCount = computed(
  () => domains.value.filter((domain) => domain.activity.trend === "升温").length,
);
const snapshotDocument = computed(() =>
  selectedDomain.value?.snapshot?.insightMd ||
  selectedDomain.value?.snapshot?.architectureMd ||
  "# 尚无今日架构快照\n\n点击“生成今日架构快照”，使用当前启用的领域地图提示词保存架构基线与北京时间今日变化。",
);

const eventLabels: Record<string, string> = {
  opened: "新建",
  updated: "更新",
  draft: "转为 Draft",
  ready_for_review: "Ready for review",
  merged: "合入",
  closed: "关闭",
  reopened: "重新打开",
};

function eventLabel(value: string) {
  return eventLabels[value] ?? value;
}

async function loadDomains() {
  loading.value = true;
  error.value = "";
  try {
    domains.value = await contentApi.domains();
    if (!selectedId.value && domains.value[0]) selectedId.value = domains.value[0].id;
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "技术领域地图加载失败";
  } finally {
    loading.value = false;
  }
}

async function createSnapshot() {
  if (!selectedDomain.value) return;
  snapshotting.value = true;
  error.value = "";
  try {
    const result = await contentApi.createDomainSnapshot(selectedDomain.value.name);
    if (result.job) {
      localJob.value = result.job;
      localEvents.value = [];
      await pollLocalJob(result.job.id);
    } else {
      await loadDomains();
    }
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "领域快照生成失败";
  } finally {
    if (!localJob.value || ["completed", "failed", "cancelled"].includes(localJob.value.status)) {
      snapshotting.value = false;
    }
  }
}

async function pollLocalJob(jobId: string) {
  if (localJobTimer !== null) window.clearTimeout(localJobTimer);
  try {
    const after = localEvents.value.at(-1)?.sequence ?? 0;
    const result = await localAnalysisApi.localAnalysisJob(jobId, after);
    localJob.value = result.job;
    localEvents.value.push(...result.events);
    if (!["completed", "failed", "cancelled"].includes(result.job.status)) {
      localJobTimer = window.setTimeout(() => pollLocalJob(jobId), 1_000);
      return;
    }
    snapshotting.value = false;
    if (result.job.status === "completed") await loadDomains();
    else error.value = result.job.error || "领域快照生成失败";
  } catch (cause) {
    snapshotting.value = false;
    error.value = cause instanceof ApiError ? cause.message : "领域快照状态读取失败";
  }
}

async function cancelLocalJob() {
  if (!localJob.value) return;
  await localAnalysisApi.cancelLocalAnalysisJob(localJob.value.id);
  localJob.value = { ...localJob.value, status: "cancel_requested" };
}

onMounted(loadDomains);
onUnmounted(() => {
  if (localJobTimer !== null) window.clearTimeout(localJobTimer);
});
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">LIVE TECHNICAL ARCHITECTURE</span>
        <h2>技术领域地图</h2>
        <p>先理解领域边界、技术结构和代码映射，再查看北京时间当天的新变化。</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ domains.length }}</strong><span>核心领域</span></div>
        <div><strong>{{ heatingCount }}</strong><span>正在升温</span></div>
      </div>
    </header>

    <p v-if="error" class="inline-error">{{ error }}</p>
    <div v-if="localJob" class="local-analysis-terminal local-analysis-terminal--insight" :data-status="localJob.status">
      <header>
        <div><span class="local-analysis-terminal__lamp" /><strong>本地架构快照</strong></div>
        <button
          v-if="!['completed', 'failed', 'cancelled'].includes(localJob.status)"
          class="button button--secondary"
          :disabled="localJob.status === 'cancel_requested'"
          @click="cancelLocalJob"
        >{{ localJob.status === 'cancel_requested' ? '正在取消' : '取消' }}</button>
      </header>
      <div class="local-analysis-terminal__events" aria-live="polite">
        <p v-if="!localEvents.length"><code>[Queue]</code> 等待本地 Runner…</p>
        <p v-for="event in localEvents" :key="event.sequence" :data-level="event.level">
          <time>{{ new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</time>
          <code>[{{ event.source }}]</code><span>{{ event.message }}</span>
        </p>
      </div>
    </div>
    <div v-if="loading" class="docs-loading">
      <span class="skeleton skeleton--title" />
      <span class="skeleton skeleton--summary" />
    </div>

    <template v-else-if="selectedDomain">
      <div class="domain-overview">
        <button
          v-for="domain in domains"
          :key="domain.id"
          class="domain-overview__item"
          :class="{ 'domain-overview__item--active': selectedId === domain.id }"
          @click="selectedId = domain.id"
        >
          <span class="domain-overview__signal" :data-trend="domain.activity.trend" />
          <strong>{{ domain.name }}</strong>
          <small>{{ domain.activity.pulls }} PR · {{ domain.activity.issues }} Issue</small>
          <span>{{ domain.activity.trend }}</span>
        </button>
      </div>

      <article class="domain-detail">
        <header class="domain-detail__header">
          <div>
            <span class="domain-badge" :data-domain="selectedDomain.name">
              <Octicon name="stack" :size="13" />
              {{ selectedDomain.name }}
            </span>
            <h3>{{ selectedDomain.name }} 技术领域架构</h3>
            <p>稳定架构基线 · {{ selectedDomain.pipeline }}</p>
          </div>
          <div class="domain-detail__actions">
            <div class="domain-detail__stats">
              <div><strong>{{ selectedDomain.activity.pulls }}</strong><span>近 7 日 PR</span></div>
              <div><strong>{{ selectedDomain.activity.issues }}</strong><span>近 7 日 Issue</span></div>
              <div><strong>{{ selectedDomain.activity.risks }}</strong><span>近 7 日重点</span></div>
            </div>
            <div class="domain-detail__buttons">
              <button class="button button--ghost" @click="emit('manage-prompt', 'domain_architecture_map')">
                <Octicon name="gear" :size="14" />
                AI 管理
              </button>
              <button class="button button--secondary" :disabled="snapshotting" @click="createSnapshot">
                <Octicon :name="snapshotting ? 'sync' : 'history'" :size="14" :class="{ spinning: snapshotting }" />
                {{ snapshotting ? "生成中…" : "生成今日架构快照" }}
              </button>
            </div>
          </div>
        </header>

        <section class="domain-code-map domain-code-map--architecture">
          <div class="domain-code-map__title">
            <div><span class="eyebrow">ARCHITECTURE BASELINE</span><h3>领域架构与技术结构</h3></div>
            <span class="domain-baseline-status"><Octicon name="shield-check" :size="13" /> 稳定基线，不随页面访问改变</span>
          </div>

          <div class="domain-architecture-intro">
            <span>领域定位与边界</span>
            <p>{{ selectedDomain.description }}</p>
          </div>

          <div class="domain-taxonomy-map">
            <span>分类规则映射</span>
            <div>
              <section>
                <strong>vLLM</strong>
                <code v-for="domain in selectedDomain.taxonomyDomains.vllm" :key="domain">{{ domain }}</code>
                <small v-if="!selectedDomain.taxonomyDomains.vllm.length">此架构域无上游独立分类</small>
              </section>
              <section>
                <strong>vLLM-Ascend</strong>
                <code v-for="domain in selectedDomain.taxonomyDomains['vllm-ascend']" :key="domain">{{ domain }}</code>
                <small v-if="!selectedDomain.taxonomyDomains['vllm-ascend'].length">此架构域无 Ascend 独立分类</small>
              </section>
            </div>
          </div>

          <div class="domain-execution-map">
            <header>
              <div><strong>关键执行链与数据流</strong><span>从入口到领域输出的技术结构</span></div>
              <code>{{ selectedDomain.pipeline }}</code>
            </header>
            <div class="domain-execution-map__flow">
              <template v-for="(node, index) in selectedDomain.architecture.executionFlow" :key="node.id">
                <article>
                  <span>{{ String(node.order).padStart(2, "0") }}</span>
                  <strong>{{ node.label }}</strong>
                </article>
                <Octicon
                  v-if="index < selectedDomain.architecture.executionFlow.length - 1"
                  name="arrow-right"
                  :size="17"
                  class="domain-execution-map__arrow"
                />
              </template>
            </div>
          </div>

          <div class="domain-code-map__title">
            <div><span class="eyebrow">IMPLEMENTATION MAP</span><h3>上游、Ascend 与验证映射</h3></div>
            <span>通用语义 → 设备适配 → 行为验证</span>
          </div>
          <div class="domain-code-map__flow">
            <template v-for="(stage, index) in selectedDomain.stages" :key="stage.label">
              <article class="domain-stage">
                <header>
                  <span>{{ index + 1 }}</span>
                  <div><strong>{{ stage.label }}</strong><small>{{ stage.repository }}</small></div>
                </header>
                <p v-if="stage.responsibility" class="domain-stage__responsibility">{{ stage.responsibility }}</p>
                <div class="domain-stage__group">
                  <span>核心路径</span>
                  <code v-for="path in stage.paths" :key="path">{{ path }}</code>
                </div>
                <div class="domain-stage__group">
                  <span>关键入口</span>
                  <p v-for="symbol in stage.symbols" :key="symbol">
                    <Octicon name="code-square" :size="13" />
                    {{ symbol }}
                  </p>
                </div>
              </article>
              <Octicon
                v-if="index < selectedDomain.stages.length - 1"
                name="arrow-right"
                :size="19"
                class="domain-code-map__arrow"
              />
            </template>
          </div>
        </section>

        <section class="domain-live-changes">
          <header>
            <div><span class="eyebrow">TODAY · ASIA/SHANGHAI</span><h3>今日最新变化</h3></div>
            <span>
              {{ selectedDomain.today.date }}
              · {{ selectedDomain.today.changes.length }} 个条目（每个条目仅展示最新事件）
            </span>
          </header>
          <p class="domain-live-changes__description">
            这里只展示北京时间当天已同步的事实，作为架构基线上的变化覆盖层；近 7 日数据仅用于顶部活跃度参考。
          </p>
          <div class="domain-live-changes__paths">
            <code v-for="path in selectedDomain.today.changedPaths" :key="path">{{ path }}</code>
            <span v-if="!selectedDomain.today.changedPaths.length">今日暂无已同步的代码路径变化。</span>
          </div>
          <div class="domain-live-changes__items">
            <article v-for="change in selectedDomain.today.changes.slice(0, 8)" :key="change.eventId">
              <span>
                {{ eventLabel(change.eventType) }} · {{ change.repo }} ·
                {{ change.kind === "pr" ? "PR" : "Issue" }} #{{ change.number }}
              </span>
              <strong>{{ change.title }}</strong>
            </article>
            <article v-if="!selectedDomain.today.changes.length" class="domain-live-changes__empty">
              <span>NO SYNCHRONIZED CHANGE</span>
              <strong>北京时间今日暂无已同步变化，不使用历史条目填充。</strong>
            </article>
          </div>
        </section>

        <section class="domain-snapshot-document">
          <header>
            <Octicon name="file" :size="16" />
            <div>
              <h3>领域架构快照文档</h3>
              <p v-if="selectedDomain.snapshot">
                {{ selectedDomain.snapshot.date }} · {{ selectedDomain.snapshot.promptTemplateName || "规则基线" }}
                · {{ selectedDomain.snapshot.promptVersion || "未记录版本" }}
                · {{ selectedDomain.snapshot.model || selectedDomain.snapshot.generationSource }}
              </p>
              <p v-else>保存完整架构介绍、技术结构图说明和当天变化，便于按日期回溯。</p>
            </div>
          </header>
          <MarkdownRenderer :content="snapshotDocument" />
          <AIExecutionFooter
            v-if="selectedDomain.snapshot"
            :engine="selectedDomain.snapshot.generationSource"
            :provider="selectedDomain.snapshot.provider"
            :model="selectedDomain.snapshot.model"
            :prompt-name="selectedDomain.snapshot.promptTemplateName"
            :prompt-version="selectedDomain.snapshot.promptVersion"
            :prompt-revision="selectedDomain.snapshot.promptRevision"
          />
        </section>
      </article>
    </template>
  </section>
</template>
