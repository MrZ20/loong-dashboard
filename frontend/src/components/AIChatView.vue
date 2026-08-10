<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useAIChat } from "../composables/useAIChat";
import type { PromptFeatureKey } from "../types/ai";
import AIChatMessages from "./AIChatMessages.vue";
import Octicon from "./Octicon.vue";

const emit = defineEmits<{
  "manage-prompt": [feature: PromptFeatureKey];
}>();

const {
  state,
  initialize,
  createThread,
  selectThread,
  deleteThread,
  send,
  cancelRepositoryJob,
} = useAIChat();
const pendingDeleteId = ref("");

const currentThread = computed(() =>
  state.threads.find((thread) => thread.id === state.threadId),
);
function relativeTime(value: string) {
  const distance = Date.now() - new Date(value).valueOf();
  if (!Number.isFinite(distance) || distance < 60_000) return "刚刚";
  if (distance < 3_600_000) return `${Math.round(distance / 60_000)} 分钟前`;
  if (distance < 86_400_000) return `${Math.round(distance / 3_600_000)} 小时前`;
  return `${Math.round(distance / 86_400_000)} 天前`;
}

async function requestDelete(threadId: string) {
  if (pendingDeleteId.value !== threadId) {
    pendingDeleteId.value = threadId;
    return;
  }
  pendingDeleteId.value = "";
  await deleteThread(threadId);
}

onMounted(initialize);
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">CONTEXTUAL COMMUNITY ASSISTANT</span>
        <h2>AI 对话</h2>
        <p>保留多个对话记录；悬浮窗与当前对话同步，并支持网页划词引用。</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ state.threads.length }}</strong><span>保留对话</span></div>
        <div><strong>{{ state.messages.length }}</strong><span>当前消息</span></div>
      </div>
    </header>

    <div class="ai-chat-workspace">
      <aside class="ai-thread-list">
        <header>
          <div><strong>对话记录</strong><small>按最近更新排序</small></div>
          <button
            class="icon-button"
            aria-label="新建对话"
            title="新建对话"
            :disabled="state.threadBusy"
            @click="createThread()"
          >
            <Octicon name="plus" :size="15" />
          </button>
        </header>

        <div class="ai-thread-list__items">
          <div
            v-for="thread in state.threads"
            :key="thread.id"
            class="ai-thread-item"
            :class="{ 'ai-thread-item--active': thread.id === state.threadId }"
          >
            <button
              class="ai-thread-item__main"
              :disabled="state.threadBusy"
              @click="selectThread(thread.id)"
            >
              <Octicon name="comment-discussion" :size="15" />
              <span>
                <strong>{{ thread.title }}</strong>
                <small>{{ relativeTime(thread.updatedAt) }}</small>
              </span>
            </button>
            <button
              class="ai-thread-item__delete"
              :class="{ 'ai-thread-item__delete--confirm': pendingDeleteId === thread.id }"
              :aria-label="pendingDeleteId === thread.id ? '确认删除对话' : '删除对话'"
              :title="pendingDeleteId === thread.id ? '再次点击确认删除' : '删除对话'"
              @click.stop="requestDelete(thread.id)"
            >
              <Octicon :name="pendingDeleteId === thread.id ? 'check' : 'trash'" :size="13" />
            </button>
          </div>
        </div>
      </aside>

      <div class="ai-chat-page">
        <header>
          <div>
            <span class="ai-chat-panel__icon"><Octicon name="copilot" :size="19" /></span>
            <div>
              <strong>{{ currentThread?.title || "LoongBoard AI" }}</strong>
              <small>PR · Issue · 代码架构 · 社区协作</small>
            </div>
          </div>
          <div class="ai-chat-page__header-actions">
            <span v-if="state.selection" class="ai-chat-page__context">
              <Octicon name="quote" :size="13" />
              已携带选中文本
            </span>
            <button
              class="button button--secondary"
              @click="emit('manage-prompt', state.mode === 'repository' ? 'repository_code_chat' : 'chat_assistant')"
            >
              <Octicon name="gear" :size="13" />AI 管理
            </button>
          </div>
        </header>

        <div v-if="state.selection" class="ai-chat-selection ai-chat-selection--page">
          <span><Octicon name="quote" :size="13" />网页选中内容</span>
          <p>{{ state.selection }}</p>
          <button class="button button--secondary" @click="state.selection = ''">清除引用</button>
        </div>

        <div class="repository-chat-mode">
          <div class="repository-chat-mode__switch">
            <button :class="{ active: state.mode === 'normal' }" @click="state.mode = 'normal'">
              普通对话
            </button>
            <button :class="{ active: state.mode === 'repository' }" @click="state.mode = 'repository'">
              <Octicon name="repo" :size="13" />仓库分析
            </button>
          </div>
          <div v-if="state.mode === 'repository'" class="repository-chat-mode__fields">
            <select v-model="state.repoScope" aria-label="仓库范围">
              <option value="vllm-ascend">vLLM-Ascend</option>
              <option value="vllm">vLLM</option>
              <option value="both">两个仓库</option>
              <option value="current">当前 PR / Issue</option>
            </select>
            <input v-model="state.targetRef" aria-label="Branch 或 Commit" placeholder="Branch 或 Commit（默认 HEAD）" />
            <span :data-online="state.localSettings?.runner.online">
              {{ state.localSettings?.runner.online ? 'Runner 在线' : 'Runner 离线' }}
            </span>
            <button
              class="button button--secondary"
              type="button"
              @click="emit('manage-prompt', 'repository_code_chat')"
            >配置 Provider / Model</button>
          </div>
        </div>

        <div v-if="state.localJob && state.mode === 'repository'" class="local-analysis-terminal local-analysis-terminal--chat" :data-status="state.localJob.status">
          <header>
            <div><span class="local-analysis-terminal__lamp" /><strong>仓库检索过程</strong></div>
            <button
              v-if="!['completed', 'failed', 'cancelled'].includes(state.localJob.status)"
              class="button button--secondary"
              :disabled="state.localJob.status === 'cancel_requested'"
              @click="cancelRepositoryJob"
            >{{ state.localJob.status === 'cancel_requested' ? '正在取消' : '取消' }}</button>
          </header>
          <div class="local-analysis-terminal__events" aria-live="polite">
            <p v-if="!state.localEvents.length"><code>[Queue]</code> 等待本地 Runner…</p>
            <p v-for="event in state.localEvents" :key="event.sequence" :data-level="event.level">
              <time>{{ new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</time>
              <code>[{{ event.source }}]</code><span>{{ event.message }}</span>
            </p>
          </div>
        </div>

        <AIChatMessages :messages="state.messages" :sending="state.sending" />
        <p v-if="state.error" class="inline-error">{{ state.error }}</p>
        <form class="ai-chat-composer ai-chat-composer--page" @submit.prevent="send()">
          <textarea
            v-model="state.draft"
            rows="3"
            placeholder="例如：解释当前 PR 对 Ascend worker 生命周期的影响"
            @keydown.enter.exact.prevent="send()"
          />
          <button class="button button--primary" :disabled="state.sending || !state.draft.trim()">
            <Octicon name="paper-airplane" :size="15" />
            发送
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
