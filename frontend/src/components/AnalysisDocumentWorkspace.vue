<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { communityApi } from "../api/community";
import { contentApi } from "../api/content";
import { ApiError } from "../api/core";
import { localAnalysisApi } from "../api/local-analysis";
import type { AnalysisDocument, LocalAnalysisEvent, LocalAnalysisJob } from "../types/analysis";
import type { CommunityItem } from "../types/community";
import type {
  PromptFeatureKey,
} from "../types/ai";
import AIExecutionFooter from "./AIExecutionFooter.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  type: string;
  scope: string;
  title: string;
  description: string;
  eyebrow: string;
  featureKey: PromptFeatureKey;
}>();

const emit = defineEmits<{
  "update:count": [count: number];
  "manage-prompt": [feature: PromptFeatureKey];
}>();

const documents = ref<AnalysisDocument[]>([]);
const selectedId = ref("");
const loading = ref(true);
const generating = ref(false);
const error = ref("");
const useLocalCode = ref(false);
const targetCandidates = ref<CommunityItem[]>([]);
const selectedTargetKeys = ref<string[]>([]);
const localJob = ref<LocalAnalysisJob | null>(null);
const localEvents = ref<LocalAnalysisEvent[]>([]);
let localJobTimer: number | null = null;

const terminalJobStatuses = new Set(["completed", "failed", "cancelled"]);

const selectedDocument = computed(
  () =>
    documents.value.find((document) => document.id === selectedId.value) ??
    documents.value[0] ??
    null,
);

async function loadDocuments() {
  loading.value = true;
  error.value = "";
  try {
    documents.value = await contentApi.analyses(props.type, props.scope);
    emit("update:count", documents.value.length);
    if (
      !selectedId.value ||
      !documents.value.some((document) => document.id === selectedId.value)
    ) {
      selectedId.value = documents.value[0]?.id ?? "";
    }
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "分析文档加载失败";
  } finally {
    loading.value = false;
  }
}

async function generate() {
  generating.value = true;
  error.value = "";
  try {
    if (useLocalCode.value && !selectedTargetKeys.value.length) {
      error.value = "使用本地代码证据时，请先选择至少一个社区事项";
      return;
    }
    const selectedTargets = targetCandidates.value
      .filter((item) => selectedTargetKeys.value.includes(`${item.repo}:${item.kind}:${item.id}`))
      .map((item) => ({ repo: item.repo, kind: item.kind, number: item.id, title: item.title }));
    const result = await contentApi.generateAnalysis({
      type: props.type,
      scope: props.scope,
      useLocalCode: useLocalCode.value,
      targets: selectedTargets,
    });
    if (result.job) {
      localJob.value = result.job;
      localEvents.value = [];
      await pollLocalJob(result.job.id);
    } else if (result.analysis) {
      await loadDocuments();
      selectedId.value = result.analysis.id;
    }
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "分析文档生成失败";
  } finally {
    if (!localJob.value || terminalJobStatuses.has(localJob.value.status)) {
      generating.value = false;
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
    if (!terminalJobStatuses.has(result.job.status)) {
      localJobTimer = window.setTimeout(() => pollLocalJob(jobId), 1_000);
      return;
    }
    generating.value = false;
    if (result.job.status === "completed") {
      await loadDocuments();
      if (result.job.analysisDocumentId) selectedId.value = result.job.analysisDocumentId;
    } else {
      error.value = result.job.error || (result.job.status === "cancelled" ? "本地代码洞察已取消" : "本地代码洞察失败");
    }
  } catch (cause) {
    generating.value = false;
    error.value = cause instanceof ApiError ? cause.message : "本地洞察状态读取失败";
  }
}

async function resumeLocalInsightJob() {
  try {
    const { jobs } = await localAnalysisApi.localAnalysisJobs();
    const job = jobs.find((candidate) =>
      ((candidate.jobType === "insight_evidence" && candidate.subjectKey === props.scope) ||
        (candidate.jobType === "managed_ai_task" && candidate.subjectKey.startsWith(`${props.type}:${props.scope}:`))) &&
      !terminalJobStatuses.has(candidate.status),
    );
    if (!job) return;
    localJob.value = job;
    localEvents.value = [];
    generating.value = true;
    await pollLocalJob(job.id);
  } catch {
    // 文档本身仍可读取；Runner 状态会在用户下次操作时明确展示。
  }
}

async function cancelLocalJob() {
  if (!localJob.value) return;
  await localAnalysisApi.cancelLocalAnalysisJob(localJob.value.id);
  localJob.value = { ...localJob.value, status: "cancel_requested" };
}

async function loadLocalTargets() {
  if (props.type !== "insight") return;
  try {
    targetCandidates.value = (await communityApi.community({ limit: 8 })).slice(0, 8);
  } catch {
    targetCandidates.value = [];
  }
}

watch(
  () => [props.type, props.scope],
  () => {
    if (localJobTimer !== null) window.clearTimeout(localJobTimer);
    selectedId.value = "";
    localJob.value = null;
    localEvents.value = [];
    generating.value = false;
    loadDocuments();
    loadLocalTargets();
    resumeLocalInsightJob();
  },
);

onMounted(() => {
  loadDocuments();
  loadLocalTargets();
  resumeLocalInsightJob();
});

onUnmounted(() => {
  if (localJobTimer !== null) window.clearTimeout(localJobTimer);
});
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">{{ eyebrow }}</span>
        <h2>{{ title }}</h2>
        <p>{{ description }}</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ documents.length }}</strong><span>历史文档</span></div>
        <div><strong>MD</strong><span>Markdown 输出</span></div>
      </div>
    </header>

    <div class="analysis-doc-toolbar">
      <div>
        <span><Octicon name="file" :size="13" />完整洞察文档</span>
        <span><Octicon name="link" :size="13" />保留证据来源</span>
        <span><Octicon name="shield-check" :size="13" />区分事实与推断</span>
      </div>
      <button class="button button--secondary" @click="emit('manage-prompt', featureKey)">
        <Octicon name="gear" :size="14" />
        AI 管理
      </button>
      <button class="button button--primary" :disabled="generating" @click="generate">
        <Octicon :name="generating ? 'sync' : 'play'" :size="14" :class="{ spinning: generating }" />
        {{ generating ? "正在生成…" : "生成新文档" }}
      </button>
    </div>

    <section v-if="type === 'insight'" class="local-evidence-selector">
      <label class="settings-checkbox">
        <input v-model="useLocalCode" type="checkbox" />使用本地代码证据
      </label>
      <p>默认不会扫描源码；仅检查下方明确选择的重点事项，并在报告中区分社区事实、代码证据与 AI 推断。</p>
      <div v-if="useLocalCode" class="local-evidence-selector__targets">
        <label v-for="item in targetCandidates" :key="`${item.repo}:${item.kind}:${item.id}`">
          <input v-model="selectedTargetKeys" type="checkbox" :value="`${item.repo}:${item.kind}:${item.id}`" />
          <span>{{ item.repo }} {{ item.kind.toUpperCase() }} #{{ item.id }}</span>
          <strong>{{ item.title }}</strong>
        </label>
      </div>
    </section>

    <div v-if="localJob" class="local-analysis-terminal local-analysis-terminal--insight" :data-status="localJob.status">
      <header>
        <div>
          <span class="local-analysis-terminal__lamp" />
          <strong>{{ localJob.jobType === 'managed_ai_task' ? '本地 AI 任务' : '本地代码证据' }}</strong>
        </div>
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

    <p v-if="error" class="inline-error">{{ error }}</p>

    <div class="analysis-doc-layout">
      <aside class="analysis-doc-index">
        <header><span>文档历史</span><small>{{ documents.length }} 份</small></header>
        <button
          v-for="document in documents"
          :key="document.id"
          :class="{ 'analysis-doc-index__item--active': selectedDocument?.id === document.id }"
          class="analysis-doc-index__item"
          @click="selectedId = document.id"
        >
          <strong>{{ document.title }}</strong>
          <span>{{ new Date(document.updatedAt).toLocaleString("zh-CN") }}</span>
          <small>{{ document.model || "未记录模型" }}</small>
        </button>
      </aside>

      <article class="analysis-doc-reader">
        <div v-if="loading" class="docs-loading">
          <span class="skeleton skeleton--title" />
          <span class="skeleton skeleton--summary" />
        </div>
        <template v-else-if="selectedDocument">
          <header>
            <div>
              <span class="eyebrow">AI ANALYSIS DOCUMENT</span>
              <h3>{{ selectedDocument.title }}</h3>
              <p>
                {{ new Date(selectedDocument.updatedAt).toLocaleString("zh-CN") }}
                · {{ selectedDocument.model || "fallback" }}
                <template v-if="selectedDocument.promptTemplateName">
                  · {{ selectedDocument.promptTemplateName }} r{{ selectedDocument.promptRevision }}
                </template>
              </p>
              <p v-if="selectedDocument.localEvidence" class="analysis-local-evidence-badge">已由本地 Agent 读取源码并校验引用</p>
            </div>
            <span class="analysis-doc-reader__status">
              <Octicon name="check-circle-fill" :size="13" />
              {{ selectedDocument.status }}
            </span>
          </header>
          <div v-if="selectedDocument.sourceRefs.length" class="analysis-doc-sources">
            <span>证据</span>
            <code v-for="source in selectedDocument.sourceRefs" :key="source">{{ source }}</code>
          </div>
          <div v-if="selectedDocument.codeReferences?.length" class="analysis-code-references">
            <span>本地代码引用</span>
            <code v-for="reference in selectedDocument.codeReferences" :key="`${reference.repository}:${reference.commitSha}:${reference.path}:${reference.startLine}`">
              {{ reference.repository }}@{{ reference.commitSha.slice(0, 12) }} · {{ reference.path }} · {{ reference.symbol }}<template v-if="reference.startLine">:{{ reference.startLine }}</template>
            </code>
          </div>
          <MarkdownRenderer :content="selectedDocument.contentMd" />
          <AIExecutionFooter
            :engine="selectedDocument.runner"
            :provider="selectedDocument.provider"
            :model="selectedDocument.model"
            :prompt-name="selectedDocument.promptTemplateName"
            :prompt-version="selectedDocument.promptVersion"
            :prompt-revision="selectedDocument.promptRevision"
          />
        </template>
        <div v-else class="empty-state">
          <span class="empty-state__icon"><Octicon name="file" :size="24" /></span>
          <h3>还没有分析文档</h3>
          <p>在设置中选择提示词，然后生成第一份 Markdown 分析。</p>
        </div>
      </article>
    </div>
  </section>
</template>
