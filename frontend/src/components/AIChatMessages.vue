<script setup lang="ts">
import type { ChatMessage } from "../types/chat";
import AIExecutionFooter from "./AIExecutionFooter.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import Octicon from "./Octicon.vue";

defineProps<{
  messages: ChatMessage[];
  sending: boolean;
}>();

function contextText(message: ChatMessage, ...keys: string[]) {
  for (const key of keys) {
    const value = message.context?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function contextNumber(message: ChatMessage, key: string) {
  const value = Number(message.context?.[key]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
</script>

<template>
  <div class="ai-chat-messages">
    <div v-if="!messages.length" class="ai-chat-empty">
      <span><Octicon name="copilot" :size="23" /></span>
      <h3>从当前页面开始提问</h3>
      <p>可以询问 PR、Issue、代码架构、跨仓库影响，也可以先在页面中选中一段文字。</p>
    </div>
    <article
      v-for="message in messages"
      :key="message.id"
      class="ai-chat-message"
      :data-role="message.role"
    >
      <span class="ai-chat-message__avatar">
        <Octicon :name="message.role === 'assistant' ? 'copilot' : 'person'" :size="15" />
      </span>
      <div>
        <small>{{ message.role === "assistant" ? "LoongBoard AI" : "你" }}</small>
        <MarkdownRenderer :content="message.contentMd" compact />
        <AIExecutionFooter
          v-if="message.role === 'assistant'"
          :engine="contextText(message, 'executionMode', 'mode')"
          :provider="contextText(message, 'providerName', 'provider', 'providerId')"
          :model="contextText(message, 'model', 'modelId')"
          :prompt-name="contextText(message, 'promptTemplateName')"
          :prompt-version="contextText(message, 'promptVersion')"
          :prompt-revision="contextNumber(message, 'promptRevision')"
        />
      </div>
    </article>
    <article v-if="sending" class="ai-chat-message" data-role="assistant">
      <span class="ai-chat-message__avatar"><Octicon name="copilot" :size="15" /></span>
      <div><small>LoongBoard AI</small><p class="ai-chat-thinking"><i /><i /><i /></p></div>
    </article>
  </div>
</template>
