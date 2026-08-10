const jsonHeaders = { "content-type": "application/json" };

function decodeSseBlock(block) {
  const data = block.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try { return JSON.parse(data); } catch { return null; }
}

function assistantResult(messages, sessionId) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info?.role !== "assistant" || message?.info?.sessionID !== sessionId) continue;
    const texts = (message.parts || [])
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text.trim())
      .filter(Boolean);
    if (!texts.length) continue;
    const combined = texts.join("\n");
    try { return JSON.parse(combined); } catch {
      const start = combined.indexOf("{");
      const end = combined.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try { return JSON.parse(combined.slice(start, end + 1)); } catch { /* continue */ }
      }
    }
  }
  return null;
}

export function sanitizeProviderResponse(response) {
  const connected = new Set(Array.isArray(response?.connected) ? response.connected.map(String) : []);
  const all = Array.isArray(response?.all) ? response.all : [];
  const providers = connected.size
    ? all.filter((provider) => connected.has(String(provider?.id || "")))
    : all;
  return providers.slice(0, 100).map((provider) => ({
    id: String(provider.id || ""),
    name: String(provider.name || provider.id || ""),
    defaultModel: String(response?.default?.[provider.id] || ""),
    models: Object.values(provider.models || {}).slice(0, 500).map((model) => ({
      id: String(model?.id || ""),
      name: String(model?.name || model?.id || ""),
    })),
  }));
}

export class OpenCodeClient {
  constructor(config) {
    const engine = config.engines.opencode;
    this.baseUrl = engine.url;
    this.authorization = `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`;
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method || "GET",
        headers: { ...jsonHeaders, authorization: this.authorization },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal || controller.signal,
      });
      if (options.expectEmpty && response.ok) return null;
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.data?.message || body?.message || `OpenCode API 返回 ${response.status}`);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  health() {
    return this.request("/global/health", { timeoutMs: 10_000 });
  }

  providers(directory) {
    return this.request(`/provider?directory=${encodeURIComponent(directory)}`);
  }

  createSession({ directory, title, model, permission }) {
    return this.request(`/session?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      body: {
        title,
        permission,
        ...(model?.providerID && model?.modelID
          ? { model: { providerID: model.providerID, id: model.modelID } }
          : {}),
      },
    });
  }

  messages(sessionId, directory) {
    return this.request(`/session/${encodeURIComponent(sessionId)}/message?directory=${encodeURIComponent(directory)}`);
  }

  promptAsync({ sessionId, directory, prompt, system, model, tools, schema }) {
    const structuredPrompt = `${prompt}\n\n只返回一个符合下列 JSON Schema 的 JSON 对象，不要使用 Markdown 代码围栏或添加对象之外的文字。LoongBoard 会在本地再次校验结构：\n${JSON.stringify(schema)}`;
    return this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      body: {
        parts: [{ type: "text", text: structuredPrompt }],
        system,
        tools,
        // OpenCode 1.18.11 /doc accepts OutputFormat objects here, but its message-
        // history response validator rejects the stored value, including
        // {type:"text"}. Omitting format preserves continuous Sessions;
        // LoongBoard validates the requested JSON structure locally.
        ...(model?.providerID && model?.modelID
          ? { model: { providerID: model.providerID, modelID: model.modelID } }
          : {}),
      },
      expectEmpty: true,
      timeoutMs: 60_000,
    });
  }

  abort(sessionId, directory) {
    return this.request(`/session/${encodeURIComponent(sessionId)}/abort?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      body: {},
      expectEmpty: true,
    });
  }

  async subscribe(directory, onEvent, signal) {
    const response = await fetch(`${this.baseUrl}/event?directory=${encodeURIComponent(directory)}`, {
      headers: { authorization: this.authorization, accept: "text/event-stream" },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`OpenCode 事件流连接失败（${response.status}）`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.search(/\r?\n\r?\n/);
      while (split >= 0) {
        const length = buffer.slice(split).startsWith("\r\n\r\n") ? 4 : 2;
        const event = decodeSseBlock(buffer.slice(0, split));
        buffer = buffer.slice(split + length);
        if (event) await onEvent(event);
        split = buffer.search(/\r?\n\r?\n/);
      }
    }
  }

  async runStructured(input) {
    const baseline = await this.messages(input.sessionId, input.directory);
    const baselineCount = baseline.length;
    const streamController = new AbortController();
    let idle = false;
    let streamError = null;
    const stream = this.subscribe(input.directory, async (event) => {
      if (event?.properties?.sessionID && event.properties.sessionID !== input.sessionId) return;
      await input.onEvent?.(event);
      if (event?.type === "session.idle" && event?.properties?.sessionID === input.sessionId) idle = true;
      if (event?.type === "session.error" && event?.properties?.sessionID === input.sessionId) {
        streamError = new Error(event?.properties?.error?.message || "OpenCode Session 执行失败");
        idle = true;
      }
    }, streamController.signal).catch((error) => {
      if (!streamController.signal.aborted) streamError = error;
    });
    try {
      await this.promptAsync(input);
      const startedAt = Date.now();
      while (Date.now() - startedAt < input.timeoutMs) {
        if (await input.shouldCancel?.()) {
          await this.abort(input.sessionId, input.directory).catch(() => {});
          const error = new Error("任务已取消");
          error.code = "CANCELLED";
          throw error;
        }
        if (streamError) throw streamError;
        const messages = await this.messages(input.sessionId, input.directory);
        const result = assistantResult(messages.slice(baselineCount), input.sessionId);
        if (result && (idle || messages.slice(baselineCount).some((message) => message?.info?.time?.completed))) return result;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      await this.abort(input.sessionId, input.directory).catch(() => {});
      throw new Error(`OpenCode 分析超过 ${Math.round(input.timeoutMs / 1_000)} 秒`);
    } finally {
      streamController.abort();
      await stream;
    }
  }
}
