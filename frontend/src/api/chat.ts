import type { ChatMessage, ChatThread } from "../types";
import { apiFetch } from "./core";

export const chatApi = {
  createThread: (title = "新对话", context: Record<string, unknown> = {}) =>
    apiFetch<{ thread: ChatThread }>("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ title, context }),
    }),

  threads: () =>
    apiFetch<{ threads: ChatThread[] }>("/api/chat/threads"),

  renameThread: (threadId: string, title: string) =>
    apiFetch<{ thread: ChatThread }>(
      `/api/chat/threads/${encodeURIComponent(threadId)}`,
      { method: "PUT", body: JSON.stringify({ title }) },
    ),

  deleteThread: (threadId: string) =>
    apiFetch<void>(`/api/chat/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    }),

  messages: (threadId: string) =>
    apiFetch<{ messages: ChatMessage[] }>(
      `/api/chat/threads/${encodeURIComponent(threadId)}/messages`,
    ),

  sendMessage: (
    threadId: string,
    input: { content: string; pageContext: string; selection: string },
  ) =>
    apiFetch<{
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
      provider: string;
    }>(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

};

