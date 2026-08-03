import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import test from "node:test";
import { loadRunnerConfig, dashboardRoot } from "../local-runner/config.mjs";
import { JobEventStream, normalizeOpenCodeEvent } from "../local-runner/event-normalizer.mjs";
import {
  canReuseRetainedWorktree,
  GitWorktreeManager,
  repositoryPreparationAction,
  safeRelativePath,
  worktreeAddArgs,
} from "../local-runner/git-worktrees.mjs";
import { OpenCodeClient, sanitizeProviderResponse } from "../local-runner/opencode-client.mjs";

async function importWorkerModule(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const domain = await importWorkerModule("worker/domain/local-analysis.ts");
const service = await importWorkerModule("worker/services/local-analysis.ts");
const routes = await importWorkerModule("worker/routes/manifest.ts");

test("识别同级 vLLM 和 vLLM-Ascend 默认仓库", () => {
  const config = loadRunnerConfig({
    LOONGBOARD_RUNNER_CONFIG: "/private/tmp/loongboard-no-runner-config.json",
  });
  assert.equal(config.repositories.vllm, resolve(dashboardRoot, "../vllm"));
  assert.equal(config.repositories["vllm-ascend"], resolve(dashboardRoot, "../vllm-ascend"));
});

test("仓库不存在时计划 clone，存在时只计划 fetch", () => {
  assert.equal(repositoryPreparationAction("/private/tmp/loongboard-definitely-missing-repo"), "clone");
  assert.equal(repositoryPreparationAction(dashboardRoot), "fetch");
});

test("仓库状态检查不会修改缺失目录", async () => {
  const missing = "/private/tmp/loongboard-readonly-missing-repo";
  const manager = new GitWorktreeManager({
    repositories: { vllm: missing, "vllm-ascend": missing },
  }, async () => {});
  assert.deepEqual(await manager.status("vllm"), {
    configured: true,
    exists: false,
    git: false,
    head: null,
  });
  assert.equal(existsSync(missing), false);
});

test("分析 Worktree 始终使用 detached add，不切换主工作区", () => {
  assert.deepEqual(worktreeAddArgs("/repo", "/worktree", "abc123"), [
    "-C", "/repo", "worktree", "add", "--detach", "/worktree", "abc123",
  ]);
});

test("同一 Commit 和保留 Worktree 可以继续 OpenCode Session", () => {
  const retained = {
    commits: { "vllm-ascend": "a".repeat(40) },
    worktrees: { "vllm-ascend": dashboardRoot },
  };
  assert.equal(canReuseRetainedWorktree(retained, ["vllm-ascend"], "a".repeat(40), "vllm-ascend"), true);
});

test("Head SHA 改变后不能复用旧 Worktree", () => {
  const retained = {
    commits: { "vllm-ascend": "a".repeat(40) },
    worktrees: { "vllm-ascend": dashboardRoot },
  };
  assert.equal(canReuseRetainedWorktree(retained, ["vllm-ascend"], "b".repeat(40), "vllm-ascend"), false);
});

test("切换仓库或 Ref 后不会复用对话代码上下文", () => {
  const thread = { repo_scope: "vllm-ascend", target_ref: "main" };
  assert.equal(service.sameChatCodeContext(thread, "vllm-ascend", "main"), true);
  assert.equal(service.sameChatCodeContext(thread, "vllm", "main"), false);
  assert.equal(service.sameChatCodeContext(thread, "vllm-ascend", "feature"), false);
});

test("OpenCode Provider 和 Model 会被净化为可公开选项", () => {
  assert.deepEqual(sanitizeProviderResponse({ connected: ["provider-a"], default: { "provider-a": "model-a" }, all: [{
    id: "provider-a",
    name: "Provider A",
    apiKey: "secret",
    models: { m: { id: "model-a", name: "Model A", secret: "hidden" } },
  }] }), [{ id: "provider-a", name: "Provider A", defaultModel: "model-a", models: [{ id: "model-a", name: "Model A" }] }]);
});

test("OpenCode Adapter 集中使用当前 Server API 路径和认证", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/session?") && options.method === "POST") {
      return new Response(JSON.stringify({ id: "ses-1" }), { status: 200 });
    }
    if (String(url).includes("/message?")) return new Response("[]", { status: 200 });
    return String(url).includes("prompt_async") || String(url).includes("/abort?")
      ? new Response(null, { status: 204 })
      : new Response("{}", { status: 200 });
  };
  try {
    const client = new OpenCodeClient({
      opencodeUrl: "http://127.0.0.1:4096",
      opencodeUsername: "opencode",
      opencodePassword: "password",
    });
    await client.createSession({ directory: "/work", title: "test", permission: [], model: {} });
    await client.messages("ses-1", "/work");
    await client.promptAsync({ sessionId: "ses-1", directory: "/work", prompt: "q", tools: {}, schema: {} });
    await client.abort("ses-1", "/work");
    assert.match(calls[0].url, /\/session\?directory=/);
    assert.match(calls[1].url, /\/session\/ses-1\/message\?directory=/);
    assert.match(calls[2].url, /\/session\/ses-1\/prompt_async\?directory=/);
    assert.match(calls[3].url, /\/session\/ses-1\/abort\?directory=/);
    assert.ok(calls.every((call) => String(call.options.headers?.authorization || "").startsWith("Basic ")));
    const promptBody = JSON.parse(calls[2].options.body);
    assert.equal(promptBody.format, undefined);
    assert.match(promptBody.parts[0].text, /JSON Schema/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenCode 工具事件转换为可恢复的结构化事件", async () => {
  const sent = [];
  const stream = new JobEventStream({ events: async (_jobId, events) => sent.push(...events) }, "job-1");
  const prepared = {
    worktrees: { "vllm-ascend": "/tmp/worktree" },
    commits: { "vllm-ascend": "a".repeat(40) },
  };
  const event = {
    type: "message.part.updated",
    properties: { part: { type: "tool", tool: "read", state: { input: { filePath: "/tmp/worktree/pkg/mod.py" } } } },
  };
  assert.equal(normalizeOpenCodeEvent(event, prepared)?.eventType, "file_read");
  assert.equal(normalizeOpenCodeEvent({ type: "session.error" }, prepared), null);
  await stream.opencode(event, prepared);
  assert.equal(sent[0].sequence, 1);
  assert.equal(sent[0].metadata.path, "pkg/mod.py");
  assert.equal(stream.sourceRead, true);
});

test("取消、事件和任务恢复接口均在 API 清单中", () => {
  assert.equal(routes.isKnownApiPath("/api/local-analysis/jobs/job-1"), true);
  assert.equal(routes.isKnownApiPath("/api/local-analysis/jobs/job-1/cancel"), true);
  assert.equal(routes.isKnownApiPath("/api/local-runner/jobs/job-1/events"), true);
});

test("Runner 心跳超时会明确判定离线", () => {
  assert.equal(domain.runnerIsOnline("2026-08-01T00:00:00.000Z", Date.parse("2026-08-01T00:00:46.000Z")), false);
  assert.equal(domain.runnerIsOnline("2026-08-01T00:00:10.000Z", Date.parse("2026-08-01T00:00:20.000Z")), true);
});

test("默认 OpenCode 权限禁止写入、Shell、外部目录和凭据", () => {
  assert.equal(domain.READ_ONLY_OPENCODE_TOOLS.read, true);
  assert.equal(domain.READ_ONLY_OPENCODE_TOOLS.bash, false);
  assert.equal(domain.READ_ONLY_OPENCODE_TOOLS.edit, false);
  assert.ok(domain.READ_ONLY_OPENCODE_PERMISSIONS.some((rule) => rule.permission === "external_directory" && rule.action === "deny"));
  assert.ok(domain.READ_ONLY_OPENCODE_PERMISSIONS.some((rule) => rule.pattern === "**/.env*" && rule.action === "deny"));
  assert.equal(safeRelativePath(".env"), null);
  assert.equal(safeRelativePath("../secret"), null);
});

test("最终代码引用必须匹配仓库、Commit、相对路径和行号", () => {
  const commit = "a".repeat(40);
  const references = domain.normalizeCodeReferences([{ repository: "vllm-ascend", commitSha: commit, path: "pkg/mod.py", symbol: "Runner", startLine: 10, endLine: 12 }], { "vllm-ascend": commit });
  assert.equal(references.length, 1);
  assert.equal(references[0].startLine, 10);
  assert.equal(domain.normalizeCodeReferences([{ repository: "vllm-ascend", commitSha: "b".repeat(40), path: "pkg/mod.py" }], { "vllm-ascend": commit }).length, 0);
});

test("AI 洞察只有显式选择目标后才排队本地证据", () => {
  const source = readFileSync("worker/services/local-analysis.ts", "utf8");
  assert.match(source, /if \(!input\.targets\.length\)/);
  assert.match(source, /sourceRead === true && codeReferences\.length > 0/);
});

test("普通对话仅在任务明确绑定 OpenCode 时转换为本地队列", () => {
  const source = readFileSync("worker/routes/chat.ts", "utf8");
  const repositoryBranch = source.indexOf('if (body.mode === "repository")');
  const localEnqueue = source.indexOf("enqueueRepositoryChat", repositoryBranch);
  const normalAnswer = source.indexOf("answerChat", repositoryBranch);
  assert.ok(repositoryBranch > 0 && localEnqueue > repositoryBranch && normalAnswer > localEnqueue);
});

test("深度分析只由显式操作启动，并按任务配置选择 API 或 OpenCode", () => {
  const source = readFileSync("worker/routes/community.ts", "utf8");
  assert.match(source, /startCommunityDeepAnalysis/);
  assert.doesNotMatch(source, /analyzeCommunityItem\(/);
  assert.match(source, /getCommunityItem/);
});
