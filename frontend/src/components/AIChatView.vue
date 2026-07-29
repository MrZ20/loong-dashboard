<script setup lang="ts">
import { onMounted } from "vue";
import { useAIChat } from "../composables/useAIChat";
import AIChatMessages from "./AIChatMessages.vue";
import Octicon from "./Octicon.vue";

const { state, initialize, send } = useAIChat();

onMounted(initialize);
</script>

<template>
  <section class="workspace-view">
    <header class="workspace-view__heading">
      <div>
        <span class="eyebrow">CONTEXTUAL COMMUNITY ASSISTANT</span>
        <h2>AI 对话</h2>
        <p>与悬浮窗共享同一对话；支持当前页面上下文和网页划词引用。</p>
      </div>
      <div class="workspace-view__metrics">
        <div><strong>{{ state.messages.length }}</strong><span>当前消息</span></div>
        <div><strong>{{ state.selection ? 1 : 0 }}</strong><span>引用片段</span></div>
      </div>
    </header>

    <div class="ai-chat-page">
      <header>
        <div>
          <span class="ai-chat-panel__icon"><Octicon name="copilot" :size="19" /></span>
          <div><strong>LoongBoard AI</strong><small>PR · Issue · 代码架构 · 社区协作</small></div>
        </div>
        <span v-if="state.selection" class="ai-chat-page__context">
          <Octicon name="quote" :size="13" />
          已携带选中文本
        </span>
      </header>

      <div v-if="state.selection" class="ai-chat-selection ai-chat-selection--page">
        <span><Octicon name="quote" :size="13" />网页选中内容</span>
        <p>{{ state.selection }}</p>
        <button class="button button--secondary" @click="state.selection = ''">清除引用</button>
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
  </section>
</template>
