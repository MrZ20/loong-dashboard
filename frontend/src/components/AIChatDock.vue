<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAIChat } from "../composables/useAIChat";
import AIChatMessages from "./AIChatMessages.vue";
import Octicon from "./Octicon.vue";

const { state, initialize, send, openWithSelection } = useAIChat();
const popover = ref({ visible: false, x: 0, y: 0, text: "", context: "" });
const messageArea = ref<HTMLElement | null>(null);

function captureSelection(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".ai-chat-dock, .selection-assistant")) return;
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (text.length < 3) {
    popover.value.visible = false;
    return;
  }
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect();
  const contextElement =
    range?.commonAncestorContainer.parentElement?.closest(
      "article, section, .community-row, .detail-section",
    ) as HTMLElement | null;
  popover.value = {
    visible: true,
    x: Math.min(rect?.right ?? event.clientX, window.innerWidth - 110),
    y: Math.max((rect?.top ?? event.clientY) - 38, 8),
    text: text.slice(0, 8_000),
    context: contextElement?.innerText.slice(0, 12_000) ?? document.title,
  };
}

function askSelection() {
  openWithSelection(popover.value.text, popover.value.context);
  popover.value.visible = false;
}

async function openDock() {
  state.open = true;
  await initialize();
}

watch(
  () => state.messages.length,
  async () => {
    await nextTick();
    if (messageArea.value) messageArea.value.scrollTop = messageArea.value.scrollHeight;
  },
);

onMounted(() => document.addEventListener("mouseup", captureSelection));
onBeforeUnmount(() => document.removeEventListener("mouseup", captureSelection));
</script>

<template>
  <button
    v-if="popover.visible"
    class="selection-assistant"
    :style="{ left: `${popover.x}px`, top: `${popover.y}px` }"
    @mousedown.prevent
    @click="askSelection"
  >
    <Octicon name="sparkle-fill" :size="13" />
    问 AI
  </button>

  <div class="ai-chat-dock" :class="{ 'ai-chat-dock--open': state.open }">
    <button
      v-if="!state.open"
      class="ai-chat-launcher"
      aria-label="打开 AI 助手"
      @click="openDock"
    >
      <Octicon name="copilot" :size="22" />
      <span v-if="state.selection">1</span>
    </button>

    <section v-else class="ai-chat-panel">
      <header>
        <span class="ai-chat-panel__icon"><Octicon name="copilot" :size="18" /></span>
        <div><strong>LoongBoard AI</strong><small>基于当前社区上下文</small></div>
        <button class="icon-button" aria-label="收起 AI 助手" @click="state.open = false">
          <Octicon name="dash" :size="17" />
        </button>
      </header>

      <div v-if="state.selection" class="ai-chat-selection">
        <span><Octicon name="quote" :size="13" />已引用选中文本</span>
        <p>{{ state.selection }}</p>
        <button class="icon-button" aria-label="清除引用" @click="state.selection = ''">
          <Octicon name="x" :size="13" />
        </button>
      </div>

      <div ref="messageArea" class="ai-chat-panel__messages">
        <AIChatMessages
          :messages="state.messages"
          :sending="state.sending"
        />
      </div>

      <p v-if="state.error" class="inline-error">{{ state.error }}</p>
      <form class="ai-chat-composer" @submit.prevent="send()">
        <textarea
          v-model="state.draft"
          rows="2"
          placeholder="询问当前页面、PR 或技术领域…"
          @keydown.enter.exact.prevent="send()"
        />
        <button class="icon-button" :disabled="state.sending || !state.draft.trim()" aria-label="发送">
          <Octicon name="paper-airplane" :size="17" />
        </button>
      </form>
    </section>
  </div>
</template>
