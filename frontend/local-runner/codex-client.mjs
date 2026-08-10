import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function asError(error) {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : JSON.stringify(error));
}

function extractJson(text) {
  const value = String(text || "").trim();
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced.trim());
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw new Error("Codex 未返回可解析的结构化 JSON");
  }
}

export function sanitizeCodexModelCatalog(models) {
  const publicModels = (Array.isArray(models) ? models : [])
    .filter((model) => !model?.hidden)
    .map((model) => ({
      id: String(model.id || model.model),
      name: String(model.displayName || model.model || model.id),
      description: String(model.description || ""),
      isDefault: Boolean(model.isDefault),
      defaultReasoningEffort: String(model.defaultReasoningEffort || ""),
      supportedReasoningEfforts: (Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts
        : [])
        .map((option) => ({
          reasoningEffort: String(option?.reasoningEffort || ""),
          description: String(option?.description || ""),
        }))
        .filter((option) => option.reasoningEffort),
    }))
    .filter((model) => model.id);
  return [...new Map(publicModels.map((model) => [model.id, model])).values()];
}

export class CodexClient {
  constructor(config) {
    this.config = config;
    this.process = null;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.activeTurns = new Map();
    this.stderr = "";
    this.initialized = false;
    this.startPromise = null;
  }

  async start() {
    if (this.initialized && this.process?.exitCode === null) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async #startProcess() {
    this.process = spawn(this.config.engines.codex.command || "codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.stderr = "";
    this.process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4_000);
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => this.#message(line));
    this.process.once("exit", (code) => {
      const error = new Error(`Codex App Server 已退出（${code ?? "unknown"}）：${this.stderr}`.slice(0, 2_000));
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
      this.initialized = false;
    });
    await this.request("initialize", {
      clientInfo: { name: "loongboard-local-runner", title: "LoongBoard Local Runner", version: this.config.version },
      capabilities: { experimentalApi: true },
    }, 15_000);
    this.notify("initialized", {});
    this.initialized = true;
  }

  #message(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (Object.hasOwn(message, "id") && message.method) {
      // The Runner is deliberately non-interactive. No permission escalation is
      // ever granted; normal read-only turns should not reach this branch.
      this.#write({ id: message.id, result: { decision: "decline" } });
      return;
    }
    if (message.method) {
      for (const listener of this.listeners) listener(message);
    }
  }

  #write(message) {
    if (!this.process?.stdin?.writable) throw new Error("Codex App Server 未运行");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server ${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.#write({ id, method, params }); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  notify(method, params) {
    this.#write({ method, params });
  }

  async health() {
    await this.start();
    const [account, models] = await Promise.all([
      this.request("account/read", { refreshToken: false }, 15_000),
      this.request("model/list", { limit: 100 }, 15_000),
    ]);
    const accountValue = account?.account ?? account ?? null;
    return {
      available: true,
      authenticated: Boolean(accountValue),
      authMode: accountValue?.type || accountValue?.authMode || "unknown",
      models: sanitizeCodexModelCatalog(models?.data),
    };
  }

  async history(threadId) {
    await this.start();
    if (!threadId) return [];
    const result = await this.request("thread/read", {
      threadId,
      includeTurns: true,
    }, 30_000);
    return result?.thread?.turns || result?.turns || [];
  }

  async cancel(threadId) {
    const turnId = this.activeTurns.get(threadId);
    if (!threadId || !turnId) return;
    await this.request("turn/interrupt", { threadId, turnId }, 10_000);
  }

  async runStructured(input) {
    await this.start();
    let threadId = input.sessionId || "";
    if (threadId) {
      try {
        await this.request("thread/resume", {
          threadId,
          cwd: input.directory,
          model: input.model || null,
          sandbox: "read-only",
          approvalPolicy: "never",
        }, 30_000);
      } catch {
        threadId = "";
      }
    }
    if (!threadId) {
      const started = await this.request("thread/start", {
        cwd: input.directory,
        model: input.model || null,
        sandbox: "read-only",
        approvalPolicy: "never",
        ephemeral: false,
        baseInstructions: input.system,
      }, 30_000);
      threadId = started?.thread?.id || started?.threadId || "";
    }
    if (!threadId) throw new Error("Codex App Server 未返回 Thread ID");

    let finalText = "";
    let turnId = "";
    let completed;
    const finished = new Promise((resolve, reject) => { completed = { resolve, reject }; });
    const listener = (message) => {
      const params = message.params || {};
      if (params.threadId !== threadId) return;
      if (turnId && params.turnId && params.turnId !== turnId) return;
      input.onEvent?.(message);
      if (message.method === "item/completed" && params.item?.type === "agentMessage") {
        finalText = String(params.item.text || finalText);
      }
      if (message.method === "turn/completed") {
        const status = params.turn?.status;
        if (status === "failed") completed.reject(new Error(params.turn?.error?.message || "Codex 分析失败"));
        else if (status === "interrupted") completed.reject(Object.assign(new Error("任务已取消"), { code: "CANCELLED" }));
        else completed.resolve();
      }
    };
    this.listeners.add(listener);
    let cancelTimer;
    try {
      const turn = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt }],
        cwd: input.directory,
        model: input.model || null,
        effort: input.effort || null,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
        outputSchema: input.schema,
      }, 30_000);
      turnId = turn?.turn?.id || turn?.turnId || "";
      if (turnId) this.activeTurns.set(threadId, turnId);
      cancelTimer = setInterval(async () => {
        if (!turnId || !(await input.shouldCancel?.())) return;
        await this.cancel(threadId).catch(() => {});
      }, 1_000);
      await Promise.race([
        finished,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Codex 分析超时")), input.timeoutMs)),
      ]);
      return { result: extractJson(finalText), sessionId: threadId };
    } catch (error) {
      const failure = asError(error);
      failure.sessionId = threadId;
      throw failure;
    } finally {
      if (cancelTimer) clearInterval(cancelTimer);
      if (this.activeTurns.get(threadId) === turnId) this.activeTurns.delete(threadId);
      this.listeners.delete(listener);
    }
  }

  stop() {
    this.process?.kill("SIGTERM");
  }
}
