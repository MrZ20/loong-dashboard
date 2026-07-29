import { computed, reactive } from "vue";
import { api, ApiError } from "../api/client";
import type { ChatMessage } from "../types";

const state = reactive({
  open: false,
  initialized: false,
  threadId: "",
  messages: [] as ChatMessage[],
  sending: false,
  error: "",
  selection: "",
  pageContext: "",
  draft: "",
});

async function initialize() {
  if (state.initialized) return;
  state.error = "";
  try {
    const { threads } = await api.threads();
    if (threads[0]) {
      state.threadId = threads[0].id;
      state.messages = (await api.messages(state.threadId)).messages;
    } else {
      const result = await api.createThread();
      state.threadId = result.thread.id;
    }
    state.initialized = true;
  } catch (cause) {
    state.error = cause instanceof ApiError ? cause.message : "AI 对话初始化失败";
  }
}

async function send(content = state.draft) {
  const question = content.trim();
  if (!question || state.sending) return;
  await initialize();
  if (!state.threadId) return;
  state.sending = true;
  state.error = "";
  state.draft = "";
  const optimistic: ChatMessage = {
    id: `pending-${Date.now()}`,
    role: "user",
    contentMd: question,
    createdAt: new Date().toISOString(),
  };
  state.messages.push(optimistic);
  try {
    const result = await api.sendMessage(state.threadId, {
      content: question,
      pageContext: state.pageContext,
      selection: state.selection,
    });
    const index = state.messages.findIndex((message) => message.id === optimistic.id);
    if (index >= 0) state.messages[index] = result.userMessage;
    state.messages.push(result.assistantMessage);
    state.selection = "";
  } catch (cause) {
    state.messages = state.messages.filter((message) => message.id !== optimistic.id);
    state.error = cause instanceof ApiError ? cause.message : "AI 回答失败";
    state.draft = question;
  } finally {
    state.sending = false;
  }
}

function setSelection(selection: string, pageContext = "") {
  state.selection = selection.slice(0, 8_000);
  if (pageContext) state.pageContext = pageContext.slice(0, 20_000);
}

function setPageContext(context: string) {
  state.pageContext = context.slice(0, 20_000);
}

function openWithSelection(selection: string, pageContext = "") {
  setSelection(selection, pageContext);
  state.open = true;
  if (!state.draft) state.draft = "请解释选中的内容，并说明它与当前技术领域和代码改动的关系。";
}

export function useAIChat() {
  return {
    state,
    hasSelection: computed(() => Boolean(state.selection)),
    initialize,
    send,
    setSelection,
    setPageContext,
    openWithSelection,
  };
}
