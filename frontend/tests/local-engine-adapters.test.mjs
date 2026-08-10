import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runAnalysisJob } from "../local-runner/analysis-job.mjs";
import { CodexEngineAdapter } from "../local-runner/engines/codex-adapter.mjs";
import {
  assertEngineAdapter,
  requestedEngineId,
  requestedSessionId,
} from "../local-runner/engines/contracts.mjs";
import { OpenCodeEngineAdapter } from "../local-runner/engines/opencode-adapter.mjs";
import { EngineRegistry } from "../local-runner/engine-registry.mjs";

function fakeAdapter(id, overrides = {}) {
  return {
    id,
    name: id,
    capabilities: { defaultReadOnly: true, permissionProfiles: ["safe_readonly"] },
    health: async () => ({ healthy: true, available: true, authenticated: true, version: "1" }),
    catalog: async () => ({ providers: [], models: [] }),
    openSession: async () => ({ id: "session", directory: "/work" }),
    history: async () => [],
    runStructured: async () => ({ result: {}, sessionId: "session" }),
    cancel: async () => {},
    normalizeEvent: () => null,
    modelCall: () => ({ message: "running", metadata: {} }),
    resultMetadata: () => ({}),
    stop: () => {},
    ...overrides,
  };
}

test("Engine Adapter contract 可注册新引擎而无需修改核心断言", () => {
  const registry = new EngineRegistry([fakeAdapter("future-engine")]);
  assert.equal(assertEngineAdapter(registry.get("future-engine")).id, "future-engine");
  assert.throws(() => new EngineRegistry([fakeAdapter("same"), fakeAdapter("same")]), /ID 重复/);
});

test("任务只读取通用引擎和 Session 字段", () => {
  assert.equal(requestedEngineId({ engineId: "codex" }), "codex");
  assert.throws(() => requestedEngineId({}), /缺少 engineId/);
  assert.equal(requestedSessionId({ agentSessionId: "session" }), "session");
  assert.equal(requestedSessionId({}), "");
  const worktrees = readFileSync("local-runner/git-worktrees.mjs", "utf8");
  assert.match(worktrees, /requestedSessionId\(job\)/);
  assert.doesNotMatch(worktrees, /job\.opencodeSessionId\s*\?/);
});

test("OpenCode Adapter 统一处理健康、目录、Session、历史、事件与取消", async () => {
  const calls = [];
  const client = {
    health: async () => ({ healthy: true, version: "1.18" }),
    providers: async () => ({ connected: [], all: [] }),
    messages: async (id, directory) => { calls.push(["history", id, directory]); return []; },
    createSession: async () => ({ id: "created" }),
    runStructured: async (input) => { calls.push(["run", input.sessionId]); return { outputText: "ok" }; },
    abort: async (id, directory) => { calls.push(["cancel", id, directory]); },
  };
  const adapter = new OpenCodeEngineAdapter({
    allowedPermissionProfiles: ["safe_readonly", "community_research"],
    engines: { opencode: { enabled: true, manageServer: false, password: "test" } },
  }, client);
  const state = { session: () => ({ sourceRead: true }), removeSession: () => assert.fail("session should be reusable") };
  const session = await adapter.openSession({
    job: { agentSessionId: "generic", providerId: "p", modelId: "m" },
    prepared: { root: "/work", reused: true },
    prompt: { title: "title" },
    state,
    policy: { id: "safe_readonly", permissions: [], tools: {} },
  });
  assert.deepEqual(session, { id: "generic", directory: "/work", reused: true, sourceRead: true });
  const response = await adapter.runStructured({
    job: { providerId: "p", modelId: "m" },
    session,
    message: "prompt",
    system: "system",
    schema: {},
    timeoutMs: 1_000,
    policy: { id: "safe_readonly", tools: {} },
  });
  await adapter.cancel(session);
  assert.equal(response.sessionId, "generic");
  assert.deepEqual(calls.map((call) => call[0]), ["history", "run", "cancel"]);
  assert.deepEqual(adapter.resultMetadata({ providerId: "p", modelId: "m" }, session.id), {
    agentSessionId: "generic",
    engineId: "opencode",
    providerId: "p",
    modelId: "m",
  });
});

test("Codex Adapter 通过同一接口暴露模型、历史、运行和取消", async () => {
  const calls = [];
  const client = {
    health: async () => ({ available: true, authenticated: true, models: [{ id: "gpt" }] }),
    history: async (id) => { calls.push(["history", id]); return [{ id: "turn" }]; },
    runStructured: async (input) => { calls.push(["run", input.sessionId, input.effort]); return { result: {}, sessionId: "thread" }; },
    cancel: async (id) => { calls.push(["cancel", id]); },
    stop: () => calls.push(["stop"]),
  };
  const adapter = new CodexEngineAdapter({
    allowedPermissionProfiles: ["safe_readonly"],
    engines: { codex: { enabled: true } },
  }, client);
  const session = await adapter.openSession({
    job: { agentSessionId: "thread" },
    prepared: { root: "/work", reused: true },
    state: { session: () => ({ sourceRead: false }) },
    policy: { id: "safe_readonly" },
  });
  assert.deepEqual(await adapter.history(session), [{ id: "turn" }]);
  await adapter.runStructured({
    job: { modelId: "gpt", request: { reasoningEffort: "high" } },
    session,
    message: "prompt",
    system: "system",
    schema: {},
    timeoutMs: 1_000,
    policy: { id: "safe_readonly" },
  });
  await adapter.cancel(session);
  assert.deepEqual(calls.slice(0, 3), [["history", "thread"], ["run", "thread", "high"], ["cancel", "thread"]]);
});

test("Registry 统一列出 health、models、capabilities 和 version", async () => {
  const registry = new EngineRegistry([
    fakeAdapter("engine-a", {
      capabilities: { defaultReadOnly: true, permissionProfiles: ["safe_readonly"], events: true },
      catalog: async () => ({ providers: [{ id: "p" }], models: [{ id: "m" }] }),
    }),
  ]);
  const [description] = await registry.describe("/work");
  assert.equal(description.id, "engine-a");
  assert.equal(description.version, "1");
  assert.equal(description.models[0].id, "m");
  assert.equal(description.capabilities.defaultReadOnly, true);
  const status = await registry.status("/work");
  assert.equal(status.engines["engine-a"].version, "1");
  assert.ok(Array.isArray(status.engines["engine-a"].capabilities));
  assert.equal(status.engineCatalogs["engine-a"].models[0].id, "m");
});

test("入口和任务编排不再包含 OpenCode/Codex 分支", () => {
  const index = readFileSync("local-runner/index.mjs", "utf8");
  const analysis = readFileSync("local-runner/analysis-job.mjs", "utf8");
  assert.doesNotMatch(index, /new (OpenCodeClient|CodexClient)/);
  assert.doesNotMatch(analysis, /events\.(opencode|codex)\(/);
  assert.match(readFileSync("local-runner/engines/opencode-adapter.mjs", "utf8"), /spawn\("opencode"/);
  const runnerSource = [
    index,
    analysis,
    readFileSync("local-runner/engine-registry.mjs", "utf8"),
    readFileSync("local-runner/engines/contracts.mjs", "utf8"),
  ].join("\n");
  assert.doesNotMatch(runnerSource, /runnerEngine|opencodeSessionId|opencodeVersion|compatibilityStatus/);
  assert.doesNotMatch(runnerSource, /engineId \|\| ["']opencode["']/);
});

test("分析任务仅通过统一 Adapter 完成 Session、事件和结果元数据", async () => {
  const emitted = [];
  const saved = [];
  const engine = fakeAdapter("future-engine", {
    capabilities: { defaultReadOnly: true, permissionProfiles: ["safe_readonly"], formatCorrection: true },
    openSession: async () => ({ id: "session-1", directory: "/work", sourceRead: false }),
    runStructured: async (input) => {
      await input.onEvent({ type: "read" });
      return {
        sessionId: "session-1",
        result: {
          outputText: { summary: "摘要" },
          summaryMd: "摘要",
          codeReferences: [],
          confirmedFacts: [],
          unresolvedIssues: [],
          focus: [],
        },
      };
    },
    normalizeEvent: () => ({
      eventType: "file_read",
      source: "future-engine",
      message: "[Read] source.py",
      metadata: {},
      level: "info",
    }),
    resultMetadata: (_job, sessionId) => ({ engineId: "future-engine", agentSessionId: sessionId }),
  });
  const context = {
    config: { timeoutSeconds: 60, allowedPermissionProfiles: ["safe_readonly"] },
    api: { status: async () => "running" },
    state: {
      saveSession: (id, value) => saved.push({ id, value }),
      removeSession: () => {},
    },
    events: {
      sourceRead: false,
      emit: async (...args) => emitted.push(args),
      engine: async (adapter, event, prepared) => {
        const normalized = adapter.normalizeEvent(event, prepared);
        if (normalized.eventType === "file_read") context.events.sourceRead = true;
        emitted.push([normalized.eventType, normalized.source, normalized.message]);
      },
    },
    engines: { forJob: () => engine },
    git: {
      prepare: async () => ({ root: "/work", worktrees: {}, commits: {}, reused: false, workspaceMode: "none" }),
      gitEvidence: async () => [],
      validateReferences: () => [],
      finalize: async () => {},
    },
  };
  const result = await runAnalysisJob({
    id: "job",
    jobType: "managed_ai_task",
    subjectKey: "subject",
    subjectKind: "issue",
    repoScope: "vllm",
    request: { purpose: "community_summary", prompt: { instruction: "根据证据生成结构化摘要。" } },
  }, context);
  assert.equal(result.engineId, "future-engine");
  assert.equal(result.agentSessionId, "session-1");
  assert.ok(saved.some((entry) => entry.value.engineId === "future-engine"));
  assert.ok(emitted.some((entry) => entry[0] === "file_read"));
});
