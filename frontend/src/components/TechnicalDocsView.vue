<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { api, ApiError } from "../api/client";
import type { TechnicalDocument } from "../types";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const emit = defineEmits<{
  "update:count": [count: number];
}>();

const documents = ref<TechnicalDocument[]>([]);
const selectedId = ref("");
const activeCategory = ref("全部");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const editing = ref(false);
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
    documents.value = await api.documents();
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
  editing.value = true;
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
      ? await api.updateDocument(draft.id, payload)
      : await api.saveDocument(payload);
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
            <button class="icon-button" aria-label="关闭编辑" @click="editing = false">
              <Octicon name="x" :size="17" />
            </button>
          </header>
          <div class="docs-editor">
            <label><span>标题</span><input v-model="draft.title" /></label>
            <div class="docs-editor__row">
              <label><span>技术分类</span><input v-model="draft.category" /></label>
              <label><span>标签（逗号分隔）</span><input v-model="draft.tags" /></label>
            </div>
            <label><span>摘要</span><textarea v-model="draft.summary" rows="2" /></label>
            <label><span>Markdown 正文</span><textarea v-model="draft.contentMd" rows="22" class="docs-editor__markdown" /></label>
            <label><span>来源（每行一个 PR、Issue 或路径）</span><textarea v-model="draft.sourceRefs" rows="4" /></label>
            <button class="button button--primary" :disabled="saving" @click="saveDocument">
              <Octicon :name="saving ? 'sync' : 'check'" :size="14" :class="{ spinning: saving }" />
              {{ saving ? "保存中…" : "保存文档" }}
            </button>
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
