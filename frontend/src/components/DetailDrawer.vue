<script setup lang="ts">
import { computed } from "vue";
import type { CommunityItem } from "../types";
import DiffViewer from "./DiffViewer.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

const props = defineProps<{
  item: CommunityItem;
  watched: boolean;
  analysisMd?: string;
  analyzing?: boolean;
  diffLoading?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "toggle-watch": [item: CommunityItem];
  analyze: [item: CommunityItem];
  "load-diff": [item: CommunityItem];
}>();

const stateLabel = computed(() => {
  const labels = {
    open: "Open",
    merged: "Merged",
    closed: "Closed",
    draft: "Draft",
  };
  return labels[props.item.state];
});
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside class="detail-drawer" aria-label="社区条目详情">
      <div class="detail-drawer__topbar">
        <span>{{ item.repo === "vllm" ? "vllm-project/vllm" : "vllm-project/vllm-ascend" }} #{{ item.id }}</span>
        <div>
          <button
            class="icon-button"
            :class="{ 'detail-watch--active': watched }"
            :aria-label="watched ? '取消关注' : '加入关注'"
            :title="watched ? '取消关注' : '加入关注'"
            @click="emit('toggle-watch', item)"
          >
            <Octicon :name="watched ? 'star-fill' : 'star'" :size="17" />
          </button>
          <a
            v-if="item.htmlUrl"
            class="icon-button"
            :href="item.htmlUrl"
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 打开"
          >
            <Octicon name="link-external" :size="17" />
          </a>
          <button class="icon-button" aria-label="关闭详情" @click="emit('close')">
            <Octicon name="x" :size="19" />
          </button>
        </div>
      </div>

      <div class="detail-drawer__scroll">
        <header class="detail-heading">
          <div class="detail-heading__state" :data-state="item.state">
            <Octicon
              :name="item.kind === 'issue' ? 'issue-opened' : item.state === 'merged' ? 'git-merge' : 'git-pull-request'"
              :size="15"
            />
            {{ stateLabel }}
          </div>
          <h2>{{ item.title }}</h2>
          <p>
            <strong>{{ item.author }}</strong>
            {{ item.kind === "pr" ? "提交了这个 Pull Request" : "创建了这个 Issue" }} · {{ item.time }}
          </p>
          <div class="detail-heading__tags">
            <span class="domain-badge" :data-domain="item.domain">
              <Octicon name="copilot" :size="12" />
              AI · {{ item.domain }}
            </span>
            <span v-if="item.important" class="important-marker">
              <Octicon name="flame" :size="13" />
              今日重点
            </span>
          </div>
        </header>

        <section class="detail-section">
          <div class="detail-section__title">
            <h3>{{ item.kind === "pr" ? "PR 描述" : "Issue 描述" }}</h3>
            <span>GitHub Markdown</span>
          </div>
          <div class="markdown-card">
            <MarkdownRenderer :content="item.bodyMd || item.body" />
          </div>
        </section>

        <section v-if="item.kind === 'pr'" class="detail-section">
          <div class="detail-section__title">
            <h3>代码修改</h3>
            <span v-if="item.diff">{{ item.diff.files }} files changed</span>
            <span v-else>按需获取</span>
          </div>
          <DiffViewer
            v-if="item.diff"
            :diff="item.diff"
            :loading="diffLoading"
            :github-url="item.htmlUrl || undefined"
            @load-diff="emit('load-diff', item)"
          />
          <div v-else class="diff-fetch-placeholder">
            <span>
              <Octicon
                :name="diffLoading ? 'sync' : 'file-diff'"
                :size="20"
                :class="{ spinning: diffLoading }"
              />
            </span>
            <div>
              <strong>正在准备变更统计</strong>
              <p>详情默认只读取文件路径和增删行数，不会提前返回具体代码内容。</p>
            </div>
          </div>
        </section>

        <section class="detail-section deep-analysis">
          <div class="detail-section__title">
            <div>
              <span class="eyebrow">AI INSIGHT</span>
              <h3>深度分析</h3>
            </div>
            <button
              class="button button--primary"
              :disabled="analyzing"
              @click="emit('analyze', item)"
            >
              <Octicon
                :name="analyzing ? 'sync' : 'copilot'"
                :size="15"
                :class="{ spinning: analyzing }"
              />
              {{ analyzing ? "分析中…" : analysisMd ? "重新分析" : "开始深度分析" }}
            </button>
          </div>

          <div v-if="!analysisMd && !analyzing" class="analysis-placeholder">
            <span>
              <Octicon name="shield-check" :size="18" />
            </span>
            <p>基于标题、正文和变更统计，分析影响范围、潜在风险与建议动作。</p>
          </div>

          <div v-else-if="analyzing" class="analysis-loading">
            <span class="analysis-orbit">
              <Octicon name="copilot" :size="21" />
            </span>
            <div>
              <strong>正在阅读社区上下文</strong>
              <span>识别技术领域与潜在影响…</span>
            </div>
          </div>

          <div v-else class="analysis-result analysis-result--markdown">
            <MarkdownRenderer :content="analysisMd" />
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>
