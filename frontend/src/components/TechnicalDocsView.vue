<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { contentApi } from "../api/content";
import { ApiError } from "../api/core";
import { localAnalysisApi } from "../api/local-analysis";
import type { AnalysisDocument, LocalAnalysisEvent, LocalAnalysisJob } from "../types/analysis";
import type { TechnicalDocument } from "../types/content";
import AIExecutionFooter from "./AIExecutionFooter.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const emit = defineEmits<{
  "update:count": [count: number];
  "manage-prompt": [feature: "technical_document_generation"];
}>();

const documents = ref<TechnicalDocument[]>([]);
const selectedId = ref("");
const activeCategory = ref("全部");
const loading = ref(true);
const saving = ref(false);
const generating = ref(false);
const error = ref("");
const editing = ref(false);
const localJob = ref<LocalAnalysisJob | null>(null);
const localEvents = ref<LocalAnalysisEvent[]>([]);
const draftExecution = ref<Pick<AnalysisDocument, "runner" | "provider" | "model" | "promptTemplateName" | "promptVersion" | "promptRevision"> | null>(null);
let localJobTimer: number | null = null;
const draft = reactive({
  id: "",
  title: "",
  category: "FusedMoE",
  summary: "",
  contentMd: "# 新技术文档\n\n从这里开始记录架构、实现机制和验证方法。",
  tags: "",
  sourceRefs: "",
});

const categories = computed(() => [
  "全部",
  ...new Set(documents.value.map((document) => document.category)),
]);
const filteredDocuments = computed(() =>
  activeCategory.value === "全部"
    ? documents.value
    : documents.value.filter(
        (document) => document.category === activeCategory.value,
      ),
);
const selectedDocument = computed(
  () =>
    documents.value.find((document) => document.id === selectedId.value) ??
    filteredDocuments.value[0] ??
    null,
);

async function loadDocuments() {
  loading.value = true;
  error.value = "";
  try {
    documents.value = await contentApi.documents();
    emit("update:count", documents.value.length);
    if (!selectedId.value && documents.value[0]) {
      selectedId.value = documents.value[0].id;
    }
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "技术文档加载失败";
  } finally {
    loading.value = false;
  }
}

function startNew() {
  Object.assign(draft, {
    id: "",
    title: "",
    category:
      activeCategory.value === "全部" ? "FusedMoE" : activeCategory.value,
    summary: "",
    contentMd: "# 新技术文档\n\n## 背景\n\n## 代码架构\n\n## 验证方法\n",
    tags: "",
    sourceRefs: "",
  });
  localJob.value = null;
  localEvents.value = [];
  draftExecution.value = null;
  editing.value = true;
}

function startEdit() {
  const document = selectedDocument.value;
  if (!document) return;
  Object.assign(draft, {
    id: document.id,
    title: document.title,
    category: document.category,
    summary: document.summary,
    contentMd: document.contentMd,
    tags: document.tags.join(", "),
    sourceRefs: document.sourceRefs.join("\n"),
  });
  localJob.value = null;
  localEvents.value = [];
  draftExecution.value = null;
  editing.value = true;
}

function draftTags() {
  return draft.tags.split(",").map((value) => value.trim()).filter(Boolean);
}

function draftSourceRefs() {
  return draft.sourceRefs.split("\n").map((value) => value.trim()).filter(Boolean);
}

async function pollDocumentJob(jobId: string) {
  if (localJobTimer !== null) window.clearTimeout(localJobTimer);
  try {
    const after = localEvents.value.at(-1)?.sequence ?? 0;
    const result = await localAnalysisApi.localAnalysisJob(jobId, after);
    localJob.value = result.job;
    localEvents.value.push(...result.events);
    if (!["completed", "failed", "cancelled"].includes(result.job.status)) {
      localJobTimer = window.setTimeout(() => pollDocumentJob(jobId), 1_000);
      return;
    }
    generating.value = false;
    if (result.job.status === "completed" && result.job.analysisDocumentId) {
      const generated = await contentApi.analysis(result.job.analysisDocumentId);
      draft.contentMd = generated.contentMd;
      draft.summary = generated.summaryMd || draft.summary;
      draftExecution.value = generated;
      return;
    }
    if (result.job.status !== "cancelled") {
      error.value = result.job.error || "本地技术文档生成失败";
    }
  } catch (cause) {
    generating.value = false;
    error.value = cause instanceof ApiError ? cause.message : "技术文档生成状态读取失败";
  }
}

async function generateDraft() {
  if (!draft.title.trim() || !draft.category.trim() || !draft.contentMd.trim()) {
    error.value = "请先填写标题、技术分类和 Markdown 草稿";
    return;
  }
  generating.value = true;
  error.value = "";
  localJob.value = null;
  localEvents.value = [];
  try {
    const result = await contentApi.generateDocumentDraft({
      title: draft.title,
      category: draft.category,
      summary: draft.summary,
      contentMd: draft.contentMd,
      tags: draftTags(),
      sourceRefs: draftSourceRefs(),
    });
    if (result.job) {
      localJob.value = result.job;
      await pollDocumentJob(result.job.id);
      return;
    }
    if (result.draft) {
      draft.contentMd = result.draft.contentMd;
      draft.summary = result.draft.summary || draft.summary;
      draftExecution.value = {
        runner: "api",
        provider: result.providerName || result.provider || "",
        model: result.model || "",
        promptTemplateName: result.promptTemplateName || "",
        promptVersion: result.promptVersion || "",
        promptRevision: Number(result.promptRevision || 1),
      };
    }
    generating.value = false;
  } catch (cause) {
    generating.value = false;
    error.value = cause instanceof ApiError ? cause.message : "技术文档生成失败";
  }
}

async function cancelGeneration() {
  if (!localJob.value) return;
  await localAnalysisApi.cancelLocalAnalysisJob(localJob.value.id);
  await pollDocumentJob(localJob.value.id);
}

async function saveDocument() {
  if (!draft.title.trim() || !draft.category.trim() || !draft.contentMd.trim()) {
    error.value = "标题、技术分类和 Markdown 正文不能为空";
    return;
  }
  saving.value = true;
  error.value = "";
  const payload = {
    title: draft.title,
    category: draft.category,
    summary: draft.summary,
    contentMd: draft.contentMd,
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    sourceRefs: draft.sourceRefs
      .split("\n")
      .map((source) => source.trim())
      .filter(Boolean),
  };
  try {
    const result = draft.id
      ? await contentApi.updateDocument(draft.id, payload)
      : await contentApi.saveDocument(payload);
    await loadDocuments();
    selectedId.value = result.document.id;
    editing.value = false;
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "技术文档保存失败";
  } finally {
    saving.value = false;
  }
}

onMounted(loadDocuments);
onBeforeUnmount(() => {
  if (localJobTimer !== null) window.clearTimeout(localJobTimer);
});
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">TECHNICAL KNOWLEDGE BASE</span>
        <h2>技术文档</h2>
        <p>按技术领域沉淀长期有效的代码架构、实现机制、验证方法与维护经验。</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ documents.length }}</strong><span>Markdown 文档</span></div>
        <div><strong>{{ Math.max(categories.length - 1, 0) }}</strong><span>技术分类</span></div>
      </div>
    </header>

    <div class="docs-toolbar">
      <div class="compact-filterbar__tabs" aria-label="技术文档分类">
        <button
          v-for="category in categories"
          :key="category"
          class="compact-filterbar__tab"
          :class="{ 'compact-filterbar__tab--active': activeCategory === category }"
          @click="activeCategory = category"
        >
          {{ category }}
        </button>
      </div>
      <button class="button button--primary" @click="startNew">
        <Octicon name="plus" :size="14" />
        新建文档
      </button>
    </div>

    <p v-if="error" class="inline-error">{{ error }}</p>

    <div v-if="loading" class="docs-loading">
      <span class="skeleton skeleton--title" />
      <span class="skeleton skeleton--summary" />
    </div>

    <div v-else class="docs-layout">
      <aside class="docs-index">
        <button
          v-for="document in filteredDocuments"
          :key="document.id"
          :class="{ 'docs-index__item--active': selectedDocument?.id === document.id }"
          class="docs-index__item"
          @click="selectedId = document.id; editing = false"
        >
          <span>{{ document.category }}</span>
          <strong>{{ document.title }}</strong>
          <small>{{ document.summary }}</small>
        </button>
      </aside>

      <article class="docs-reader">
        <template v-if="editing">
          <header class="docs-reader__header">
            <div><span class="eyebrow">MARKDOWN EDITOR</span><h3>{{ draft.id ? "编辑技术文档" : "新建技术文档" }}</h3></div>
            <div class="docs-reader__header-actions">
              <button class="button button--secondary" @click="emit('manage-prompt', 'technical_document_generation')">AI 管理</button>
              <button class="button button--secondary" :disabled="generating" @click="generateDraft">
                <Octicon :name="generating ? 'sync' : 'copilot'" :size="14" :class="{ spinning: generating }" />
                {{ generating ? "生成中…" : "AI 生成草稿" }}
              </button>
              <button class="icon-button" aria-label="关闭编辑" @click="editing = false">
                <Octicon name="x" :size="17" />
              </button>
            </div>
          </header>
          <div class="docs-editor">
            <label><span>标题</span><input v-model="draft.title" /></label>
            <div class="docs-editor__row">
              <label><span>技术分类</span><input v-model="draft.category" /></label>
              <label><span>标签（逗号分隔）</span><input v-model="draft.tags" /></label>
            </div>
            <label><span>摘要</span><textarea v-model="draft.summary" rows="2" /></label>
            <label><span>Markdown 正文</span><textarea v-model="draft.contentMd" rows="22" class="docs-editor__markdown" /></label>
            <AIExecutionFooter
              v-if="draftExecution"
              :engine="draftExecution.runner"
              :provider="draftExecution.provider"
              :model="draftExecution.model"
              :prompt-name="draftExecution.promptTemplateName"
              :prompt-version="draftExecution.promptVersion"
              :prompt-revision="draftExecution.promptRevision"
            />
            <label><span>来源（每行一个 PR、Issue 或路径）</span><textarea v-model="draft.sourceRefs" rows="4" /></label>
            <button class="button button--primary" :disabled="saving" @click="saveDocument">
              <Octicon :name="saving ? 'sync' : 'check'" :size="14" :class="{ spinning: saving }" />
              {{ saving ? "保存中…" : "保存文档" }}
            </button>
          </div>
          <div v-if="localJob" class="local-analysis-terminal" :data-status="localJob.status">
            <header>
              <div><span class="local-analysis-terminal__lamp" /><strong>技术文档生成</strong></div>
              <button
                v-if="!['completed', 'failed', 'cancelled'].includes(localJob.status)"
                class="button button--secondary"
                :disabled="localJob.status === 'cancel_requested'"
                @click="cancelGeneration"
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
        </template>

        <template v-else-if="selectedDocument">
          <header class="docs-reader__header">
            <div>
              <span class="domain-badge" :data-domain="selectedDocument.category">
                {{ selectedDocument.category }}
              </span>
              <h3>{{ selectedDocument.title }}</h3>
              <p>{{ selectedDocument.summary }}</p>
              <div class="docs-reader__tags">
                <span v-for="tag in selectedDocument.tags" :key="tag">{{ tag }}</span>
              </div>
            </div>
            <button class="button button--secondary" @click="startEdit">
              <Octicon name="pencil" :size="14" />
              编辑
            </button>
          </header>
          <MarkdownRenderer :content="selectedDocument.contentMd" />
        </template>

        <div v-else class="empty-state">
          <span class="empty-state__icon"><Octicon name="book" :size="24" /></span>
          <h3>当前分类还没有技术文档</h3>
          <p>新建一份 Markdown 文档来记录代码架构和维护经验。</p>
        </div>
      </article>
    </div>
  </section>
</template>
