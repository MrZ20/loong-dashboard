<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../api/client";
import type { AnalysisDocument } from "../types";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  type: string;
  scope: string;
  title: string;
  description: string;
  eyebrow: string;
  defaultPrompt: string;
}>();

const emit = defineEmits<{
  "update:count": [count: number];
}>();

const documents = ref<AnalysisDocument[]>([]);
const selectedId = ref("");
const prompt = ref(props.defaultPrompt);
const loading = ref(true);
const generating = ref(false);
const showPrompt = ref(false);
const error = ref("");

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
    documents.value = await api.analyses(props.type, props.scope);
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
    const result = await api.generateAnalysis({
      type: props.type,
      scope: props.scope,
      prompt: prompt.value,
    });
    await loadDocuments();
    selectedId.value = result.analysis.id;
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : "分析文档生成失败";
  } finally {
    generating.value = false;
  }
}

watch(
  () => [props.type, props.scope],
  () => {
    selectedId.value = "";
    loadDocuments();
  },
);

onMounted(loadDocuments);
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
      <button class="button button--secondary" @click="showPrompt = !showPrompt">
        <Octicon name="command-palette" :size="14" />
        {{ showPrompt ? "收起提示词" : "编辑提示词" }}
      </button>
      <button class="button button--primary" :disabled="generating" @click="generate">
        <Octicon :name="generating ? 'sync' : 'play'" :size="14" :class="{ spinning: generating }" />
        {{ generating ? "正在生成…" : "生成新文档" }}
      </button>
    </div>

    <div v-if="showPrompt" class="analysis-doc-prompt">
      <label class="prompt-field">
        <span>Prompt</span>
        <textarea v-model="prompt" rows="5" />
        <small>{{ prompt.length }} 字</small>
      </label>
      <p>模型将读取已同步的 PR、Issue、跨仓库关系、关注项与技术领域变化。</p>
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
              </p>
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
          <MarkdownRenderer :content="selectedDocument.contentMd" />
        </template>
        <div v-else class="empty-state">
          <span class="empty-state__icon"><Octicon name="file" :size="24" /></span>
          <h3>还没有分析文档</h3>
          <p>配置提示词并生成第一份 Markdown 分析。</p>
        </div>
      </article>
    </div>
  </section>
</template>
