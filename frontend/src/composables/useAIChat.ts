import { computed, reactive } from "vue";
import { api, ApiError } from "../api/client";
import type {
  ChatMessage,
  ChatThread,
  LocalAnalysisEvent,
  LocalAnalysisJob,
  LocalRunnerSettingsState,
} from "../types";

const state = reactive({
  open: false,
  initialized: false,
  threadId: "",
  threads: [] as ChatThread[],
  messages: [] as ChatMessage[],
  sending: false,
  threadBusy: false,
  error: "",
  selection: "",
  pageContext: "",
  draft: "",
  mode: "normal" as "normal" | "repository",
  repoScope: "vllm-ascend",
  targetRef: "HEAD",
  providerId: "",
  modelId: "",
  localJob: null as LocalAnalysisJob | null,
  localEvents: [] as LocalAnalysisEvent[],
  localSettings: null as LocalRunnerSettingsState | null,
});

let initializingPromise: Promise<void> | null = null;
let localJobTimer: number | null = null;

function stopLocalJobPolling() {
  if (localJobTimer !== null) window.clearTimeout(localJobTimer);
  localJobTimer = null;
}

function applyThreadMode(thread?: ChatThread) {
  state.mode = thread?.mode || "normal";
  state.repoScope = thread?.repoScope || "vllm-ascend";
  state.targetRef = thread?.targetRef || "HEAD";
  state.providerId = thread?.providerId || state.localSettings?.settings.defaultProvider || "";
  state.modelId = thread?.modelId || state.localSettings?.settings.defaultModel || "";
}

async function pollRepositoryJob(jobId: string, threadId: string) {
  stopLocalJobPolling();
  try {
    const after = state.localEvents.at(-1)?.sequence ?? 0;
    const result = await api.localAnalysisJob(jobId, after);
    if (state.threadId !== threadId) return;
    state.localJob = result.job;
    state.localEvents.push(...result.events);
    if (!["completed", "failed", "cancelled"].includes(result.job.status)) {
      state.sending = true;
      localJobTimer = window.setTimeout(() => pollRepositoryJob(jobId, threadId), 1_000);
      return;
    }
    state.sending = false;
    state.messages = (await api.messages(threadId)).messages;
    const { threads } = await api.threads();
    state.threads = threads;
    sortThreads();
    if (result.job.status === "failed") state.error = result.job.error || "仓库分析失败";
    if (result.job.status === "cancelled") state.error = "仓库分析已取消";
  } catch (cause) {
    state.sending = false;
    state.error = cause instanceof ApiError ? cause.message : "仓库分析状态读取失败";
  }
}

async function resumeThreadJob(thread?: ChatThread) {
  stopLocalJobPolling();
  state.localEvents = [];
  state.localJob = null;
  if (!thread?.runnerJobId) return;
  state.sending = true;
  await pollRepositoryJob(thread.runnerJobId, thread.id);
}

function sortThreads() {
  state.threads.sort(
    (left, right) =>
      new Date(right.updatedAt).valueOf() - new Date(left.updatedAt).valueOf(),
  );
}

async function initialize() {
  if (state.initialized) return;
  if (initializingPromise) return initializingPromise;
  initializingPromise = (async () => {
    state.error = "";
    try {
      const [{ threads }, localSettings] = await Promise.all([
        api.threads(),
        api.localAnalysisSettings().catch(() => null),
      ]);
      state.localSettings = localSettings;
      state.threads = threads;
      if (threads[0]) {
        state.threadId = threads[0].id;
        state.messages = (await api.messages(state.threadId)).messages;
        applyThreadMode(threads[0]);
        await resumeThreadJob(threads[0]);
      } else {
        const result = await api.createThread();
        state.threads = [result.thread];
        state.threadId = result.thread.id;
        state.messages = [];
        applyThreadMode(result.thread);
      }
      state.initialized = true;
    } catch (cause) {
      state.error =
        cause instanceof ApiError ? cause.message : "AI 对话初始化失败";
    } finally {
      initializingPromise = null;
    }
  })();
  return initializingPromise;
}

async function createThread(title = "新对话") {
  if (state.threadBusy) return;
  state.threadBusy = true;
  state.error = "";
  try {
    const result = await api.createThread(title, {
      pageContext: state.pageContext,
    });
    state.threads.unshift(result.thread);
    state.threadId = result.thread.id;
    state.messages = [];
    state.draft = "";
    state.initialized = true;
    applyThreadMode(result.thread);
    stopLocalJobPolling();
    state.localJob = null;
    state.localEvents = [];
  } catch (cause) {
    state.error = cause instanceof ApiError ? cause.message : "新建对话失败";
  } finally {
    state.threadBusy = false;
  }
}

async function selectThread(threadId: string) {
  if (!threadId || threadId === state.threadId || state.threadBusy) return;
  state.threadBusy = true;
  state.error = "";
  try {
    state.messages = (await api.messages(threadId)).messages;
    state.threadId = threadId;
    state.draft = "";
    const thread = state.threads.find((item) => item.id === threadId);
    applyThreadMode(thread);
    await resumeThreadJob(thread);
  } catch (cause) {
    state.error = cause instanceof ApiError ? cause.message : "对话加载失败";
  } finally {
    state.threadBusy = false;
  }
}

async function deleteThread(threadId: string) {
  if (!threadId || state.threadBusy) return;
  state.threadBusy = true;
  state.error = "";
  try {
    await api.deleteThread(threadId);
    state.threads = state.threads.filter((thread) => thread.id !== threadId);
    if (state.threadId === threadId) {
      const next = state.threads[0];
      if (next) {
        state.threadId = next.id;
        state.messages = (await api.messages(next.id)).messages;
      } else {
        const created = await api.createThread();
        state.threads = [created.thread];
        state.threadId = created.thread.id;
        state.messages = [];
      }
    }
  } catch (cause) {
    state.error = cause instanceof ApiError ? cause.message : "删除对话失败";
  } finally {
    state.threadBusy = false;
  }
}

async function renameThread(threadId: string, title: string) {
  const cleanTitle = title.trim();
  if (!cleanTitle || state.threadBusy) return;
  state.threadBusy = true;
  try {
    const { thread } = await api.renameThread(threadId, cleanTitle);
    const index = state.threads.findIndex((item) => item.id === threadId);
    if (index >= 0) state.threads[index] = thread;
    sortThreads();
  } catch (cause) {
    state.error = cause instanceof ApiError ? cause.message : "重命名对话失败";
  } finally {
    state.threadBusy = false;
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
      mode: state.mode,
      repoScope: state.repoScope,
      targetRef: state.targetRef,
    });
    const index = state.messages.findIndex((message) => message.id === optimistic.id);
    if (index >= 0) state.messages[index] = result.userMessage;
    if (result.assistantMessage) state.messages.push(result.assistantMessage);
    if (result.effectiveMode === "repository") state.mode = "repository";
    const thread = state.threads.find((item) => item.id === state.threadId);
    if (thread) {
      if (thread.title === "新对话") thread.title = question.slice(0, 50);
      thread.updatedAt = result.assistantMessage?.createdAt || result.job?.updatedAt || new Date().toISOString();
      thread.mode = state.mode;
      thread.repoScope = state.repoScope;
      thread.targetRef = state.targetRef;
      thread.runnerJobId = result.job?.id || null;
      sortThreads();
    }
    state.selection = "";
    if (result.job) {
      state.localJob = result.job;
      state.localEvents = [];
      await pollRepositoryJob(result.job.id, state.threadId);
    }
  } catch (cause) {
    state.messages = state.messages.filter((message) => message.id !== optimistic.id);
    state.error = cause instanceof ApiError ? cause.message : "AI 回答失败";
    state.draft = question;
  } finally {
    if (!state.localJob || ["completed", "failed", "cancelled"].includes(state.localJob.status)) {
      state.sending = false;
    }
  }
}

async function cancelRepositoryJob() {
  if (!state.localJob) return;
  try {
    await api.cancelLocalAnalysisJob(state.localJob.id);
    state.localJob = { ...state.localJob, status: "cancel_requested" };
  } catch (cause) {
    state.error = cause instanceof ApiError ? cause.message : "取消仓库分析失败";
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
    createThread,
    selectThread,
    deleteThread,
    renameThread,
    send,
    setSelection,
    setPageContext,
    openWithSelection,
    cancelRepositoryJob,
  };
}
