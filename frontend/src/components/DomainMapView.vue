<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../api/client";
import type { DomainMapApi } from "../types";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const domains = ref<DomainMapApi[]>([]);
const selectedId = ref("");
const loading = ref(true);
const snapshotting = ref(false);
const error = ref("");

const selectedDomain = computed(
  () =>
    domains.value.find((domain) => domain.id === selectedId.value) ??
    domains.value[0] ??
    null,
);
const heatingCount = computed(
  () => domains.value.filter((domain) => domain.activity.trend === "升温").length,
);

async function loadDomains() {
  loading.value = true;
  error.value = "";
  try {
    domains.value = await api.domains();
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
    await api.createDomainSnapshot(selectedDomain.value.name);
    await loadDomains();
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "领域快照生成失败";
  } finally {
    snapshotting.value = false;
  }
}

onMounted(loadDomains);
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">LIVE TECHNICAL ARCHITECTURE</span>
        <h2>技术领域地图</h2>
        <p>长期代码架构作为基线，叠加每日 PR、Issue、活跃路径与风险变化。</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ domains.length }}</strong><span>核心领域</span></div>
        <div><strong>{{ heatingCount }}</strong><span>正在升温</span></div>
      </div>
    </header>

    <p v-if="error" class="inline-error">{{ error }}</p>
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
            <h3>{{ selectedDomain.description }}</h3>
            <p>{{ selectedDomain.pipeline }}</p>
          </div>
          <div class="domain-detail__actions">
            <div class="domain-detail__stats">
              <div><strong>{{ selectedDomain.activity.pulls }}</strong><span>活跃 PR</span></div>
              <div><strong>{{ selectedDomain.activity.issues }}</strong><span>开放 Issue</span></div>
              <div><strong>{{ selectedDomain.activity.risks }}</strong><span>风险项</span></div>
            </div>
            <button class="button button--secondary" :disabled="snapshotting" @click="createSnapshot">
              <Octicon :name="snapshotting ? 'sync' : 'history'" :size="14" :class="{ spinning: snapshotting }" />
              {{ snapshotting ? "生成中…" : "生成今日快照" }}
            </button>
          </div>
        </header>

        <section class="domain-live-changes">
          <header>
            <div><span class="eyebrow">DAILY CHANGE LAYER</span><h3>每日变化层</h3></div>
            <span>
              {{ selectedDomain.snapshot?.date || "尚无快照" }}
              · {{ selectedDomain.changes.length }} 个社区变化
            </span>
          </header>
          <div class="domain-live-changes__paths">
            <code v-for="path in selectedDomain.changedPaths" :key="path">{{ path }}</code>
            <span v-if="!selectedDomain.changedPaths.length">同步包含 diff 的 PR 后，这里会显示当天活跃代码路径。</span>
          </div>
          <div class="domain-live-changes__items">
            <article v-for="change in selectedDomain.changes.slice(0, 6)" :key="change.id">
              <span>{{ change.repo }} · {{ change.kind === "pr" ? "PR" : "Issue" }} #{{ change.number }}</span>
              <strong>{{ change.title }}</strong>
            </article>
          </div>
        </section>

        <section class="domain-code-map">
          <div class="domain-code-map__title">
            <div><span class="eyebrow">ARCHITECTURE BASELINE</span><h3>代码架构基线</h3></div>
            <span>基线结构 + 每日活跃路径</span>
          </div>
          <div class="domain-code-map__flow">
            <template v-for="(stage, index) in selectedDomain.stages" :key="stage.label">
              <article class="domain-stage">
                <header>
                  <span>{{ index + 1 }}</span>
                  <div><strong>{{ stage.label }}</strong><small>{{ stage.repository }}</small></div>
                </header>
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

        <section class="domain-snapshot-document">
          <header>
            <Octicon name="file" :size="16" />
            <div><h3>领域快照文档</h3><p>记录架构基线和当天变化，便于按日期回溯。</p></div>
          </header>
          <MarkdownRenderer
            :content="selectedDomain.snapshot?.insightMd || '# 尚无今日快照\n\n点击“生成今日快照”保存当前领域变化。'"
          />
        </section>
      </article>
    </template>
  </section>
</template>
