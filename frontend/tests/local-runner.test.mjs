import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { importWorkerModule } from "./helpers/import-worker-module.mjs";
import { loadRunnerConfig, dashboardRoot } from "../local-runner/config.mjs";
import { JobEventStream, normalizeCodexEvent, normalizeOpenCodeEvent } from "../local-runner/event-normalizer.mjs";
import {
  canReuseRetainedWorkspace,
  WorkspaceManager,
  isPinnedCommit,
  repositoryPreparationAction,
  runProcess,
  safeRelativePath,
  selectFetchRemote,
  worktreeAddArgs,
} from "../local-runner/git-worktrees.mjs";
import { permissionProfile, resolvePermissionPolicy } from "../local-runner/permission-profiles.mjs";
import { OpenCodeClient, sanitizeProviderResponse } from "../local-runner/opencode-client.mjs";
import { sanitizeCodexModelCatalog } from "../local-runner/codex-client.mjs";
import { buildRunnerPrompt, validateStructuredResult } from "../local-runner/prompts.mjs";

const domain = await importWorkerModule("worker/domain/local-analysis.ts");
const service = await importWorkerModule("worker/services/local-runtime/mappers.ts");
const localRunnerRepository = await importWorkerModule("worker/repositories/local-runner.ts");
const routes = await importWorkerModule("worker/routes/manifest.ts");

test("识别同级 vLLM 和 vLLM-Ascend 默认仓库", () => {
  const config = loadRunnerConfig({
    LOONGBOARD_RUNNER_CONFIG: "/private/tmp/loongboard-no-runner-config.json",
  });
  assert.equal(config.repositories.vllm.path, resolve(dashboardRoot, "../vllm"));
  assert.equal(config.repositories["vllm-ascend"].path, resolve(dashboardRoot, "../vllm-ascend"));
});

test("仓库不存在时计划 clone，存在时只计划 fetch", () => {
  assert.equal(repositoryPreparationAction("/private/tmp/loongboard-definitely-missing-repo"), "clone");
  assert.equal(repositoryPreparationAction(dashboardRoot), "fetch");
});

test("仓库状态检查不会修改缺失目录", async () => {
  const missing = "/private/tmp/loongboard-readonly-missing-repo";
  const manager = new WorkspaceManager({
    repositories: {
      vllm: { path: missing, cloneUrl: "https://example.invalid/vllm.git" },
      "vllm-ascend": { path: missing, cloneUrl: "https://example.invalid/vllm-ascend.git" },
    },
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

test("临时 Worktree 每个任务独立创建并在结束后即时清理", async () => {
  const root = mkdtempSync(join(tmpdir(), "loongboard-ephemeral-worktree-"));
  try {
    const repository = join(root, "repository");
    const worktreeRoot = join(root, "worktrees");
    mkdirSync(repository);
    await runProcess("git", ["init", "-b", "main", repository]);
    writeFileSync(join(repository, "version.txt"), "main\n");
    await runProcess("git", ["-C", repository, "add", "version.txt"]);
    await runProcess("git", ["-C", repository, "-c", "user.name=LoongBoard", "-c", "user.email=test@example.com", "commit", "-m", "main"]);
    const originalHead = (await runProcess("git", ["-C", repository, "rev-parse", "HEAD"])).stdout;
    const events = [];

    const manager = new WorkspaceManager({
      repositories: {
        vllm: { path: repository, cloneUrl: "https://example.invalid/vllm.git" },
        "vllm-ascend": { path: repository, cloneUrl: "https://example.invalid/vllm-ascend.git" },
      },
      worktreeRoot,
      scratchRoot: join(root, "scratch"),
      autoFetch: false,
    }, async (...event) => events.push(event));
    const prepared = await manager.prepare({
      id: "ephemeral-worktree-test",
      repoScope: "vllm",
      headSha: originalHead,
      request: { workspaceMode: "ephemeral_worktree", updatePolicy: "none" },
    }, { session: () => null });
    assert.equal(prepared.workspaceMode, "ephemeral_worktree");
    assert.equal(prepared.commits.vllm, originalHead);
    assert.equal(existsSync(prepared.worktrees.vllm), true);
    assert.equal((await runProcess("git", ["-C", repository, "symbolic-ref", "--short", "HEAD"])).stdout, "main");
    const parallel = await manager.prepare({
      id: "ephemeral-worktree-parallel",
      repoScope: "vllm",
      headSha: originalHead,
      request: { workspaceMode: "ephemeral_worktree", updatePolicy: "none" },
    }, { session: () => null });
    assert.notEqual(parallel.worktrees.vllm, prepared.worktrees.vllm);
    assert.equal(existsSync(parallel.worktrees.vllm), true);

    await Promise.all([manager.finalize(prepared), manager.finalize(parallel)]);

    assert.equal(existsSync(prepared.root), false);
    assert.equal(existsSync(parallel.root), false);
    assert.equal((await runProcess("git", ["-C", repository, "rev-parse", "HEAD"])).stdout, originalHead);
    assert.ok(events.some(([type]) => type === "worktree_cleanup"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PR 摘要准备本地版本前会携带 PR 编号获取对应 Head ref", () => {
  const summaryRefresh = readFileSync("worker/services/summary-refresh.ts", "utf8");
  assert.match(
    summaryRefresh,
    /purpose: "community_summary"[\s\S]*?request: \{[\s\S]*?number: Number\(row\.number\)/,
  );
  const worktrees = readFileSync("local-runner/git-worktrees.mjs", "utf8");
  assert.match(worktrees, /fetch\(repository, request\.number \|\| null\)/);
  assert.match(worktrees, /`pull\/\$\{pullNumber\}\/head`/);
});

test("社区 PR ref 从匹配规范仓库的 remote 获取，而不是固定使用 origin", () => {
  const remotes = [
    { name: "origin", url: "git@github.com:MrZ20/vllm-ascend.git" },
    { name: "upstream", url: "git@github.com:vllm-project/vllm-ascend.git" },
  ];
  assert.equal(
    selectFetchRemote(remotes, "https://github.com/vllm-project/vllm-ascend.git"),
    "upstream",
  );
  assert.equal(selectFetchRemote(remotes, "https://github.com/unknown/repo.git"), "origin");
});

test("只有完整 Commit SHA 才允许使用本地对象跳过远端获取", () => {
  assert.equal(isPinnedCommit("a".repeat(40)), true);
  assert.equal(isPinnedCommit("abc123"), false);
  assert.equal(isPinnedCommit("main"), false);
});

test("PR 和 Issue 摘要把业务 JSON 纳入本地 Agent 的强制输出 Schema", () => {
  const prepared = { commits: {}, worktrees: {} };
  const baseJob = {
    jobType: "managed_ai_task",
    subjectKey: "subject",
    repoScope: "vllm-ascend",
    request: { purpose: "community_summary", prompt: { instruction: "根据证据生成结构化摘要。" } },
  };
  const pr = buildRunnerPrompt({ ...baseJob, subjectKind: "pr" }, prepared, []);
  assert.equal(pr.schema.properties.outputText.type, "object");
  assert.ok(pr.schema.properties.outputText.required.includes("keyChanges"));
  assert.match(pr.prompt, /outputText 必须是对象/);

  const issue = buildRunnerPrompt({ ...baseJob, subjectKind: "issue" }, prepared, []);
  assert.ok(issue.schema.properties.outputText.required.includes("issueType"));
  assert.equal(issue.schema.properties.outputText.properties.implementation, undefined);
});

test("本地 Agent 的摘要对象会统一序列化后交给 Worker 业务校验", () => {
  const result = validateStructuredResult({
    outputText: { summary: "摘要" },
    summaryMd: "摘要",
    codeReferences: [],
    confirmedFacts: [],
    unresolvedIssues: [],
    focus: [],
  }, "outputText");
  assert.deepEqual(JSON.parse(result.outputText), { summary: "摘要" });
});

test("同一 Commit 和保留 Worktree 可以继续 OpenCode Session", () => {
  const retained = {
    commits: { "vllm-ascend": "a".repeat(40) },
    worktrees: { "vllm-ascend": dashboardRoot },
    workspaceMode: "worktree",
    permissionProfileId: "safe_readonly",
  };
  assert.equal(canReuseRetainedWorkspace(retained, ["vllm-ascend"], "a".repeat(40), "vllm-ascend", "worktree", "safe_readonly"), true);
});

test("Head SHA 改变后不能复用旧 Worktree", () => {
  const retained = {
    commits: { "vllm-ascend": "a".repeat(40) },
    worktrees: { "vllm-ascend": dashboardRoot },
    workspaceMode: "worktree",
    permissionProfileId: "safe_readonly",
  };
  assert.equal(canReuseRetainedWorkspace(retained, ["vllm-ascend"], "b".repeat(40), "vllm-ascend", "worktree", "safe_readonly"), false);
});

test("切换工作区模式或权限档案后不会复用旧 Session 工作区", () => {
  const retained = {
    commits: { vllm: "a".repeat(40) },
    worktrees: { vllm: dashboardRoot },
    workspaceMode: "worktree",
    permissionProfileId: "safe_readonly",
  };
  assert.equal(canReuseRetainedWorkspace(
    retained, ["vllm"], "a".repeat(40), "vllm", "ephemeral_worktree", "safe_readonly",
  ), false);
  assert.equal(canReuseRetainedWorkspace(
    retained, ["vllm"], "a".repeat(40), "vllm", "worktree", "community_research",
  ), false);
});

test("临时 Worktree 无论版本是否一致都不复用旧代码 Session", () => {
  const retained = {
    commits: { vllm: "a".repeat(40) },
    worktrees: { vllm: dashboardRoot },
    workspaceMode: "ephemeral_worktree",
    permissionProfileId: "safe_readonly",
  };
  assert.equal(canReuseRetainedWorkspace(
    retained, ["vllm"], "a".repeat(40), "vllm", "ephemeral_worktree", "safe_readonly",
  ), false);
  const analysisJob = readFileSync("local-runner/analysis-job.mjs", "utf8");
  assert.match(analysisJob, /await git\.finalize\(prepared\)/);
  assert.match(analysisJob, /finally \{[\s\S]*await git\.finalize\(prepared\)/);
  assert.match(analysisJob, /临时 Worktree 清理失败/);
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
    const client = new OpenCodeClient({ engines: { opencode: {
      url: "http://127.0.0.1:4096", username: "opencode", password: "password",
    } } });
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
  await stream.engine({ normalizeEvent: normalizeOpenCodeEvent }, event, prepared);
  assert.equal(sent[0].sequence, 1);
  assert.equal(sent[0].metadata.path, "pkg/mod.py");
  assert.equal(stream.sourceRead, true);
});

test("Codex 事件被转换为统一结构且不暴露隐藏推理", () => {
  const prepared = { worktrees: { vllm: "/tmp/worktree" } };
  const event = {
    method: "item/completed",
    params: { item: { type: "commandExecution", command: "rg NPUModelRunner vllm", cwd: "/tmp/worktree", status: "completed" } },
  };
  const normalized = normalizeCodexEvent(event, prepared);
  assert.equal(normalized.eventType, "symbol_search");
  assert.equal(normalized.source, "codex");
  assert.equal(normalizeCodexEvent({ method: "item/reasoning/delta", params: {} }, prepared), null);
});

test("Codex Adapter 只通过本机 App Server 且强制只读", () => {
  const source = readFileSync("local-runner/codex-client.mjs", "utf8");
  assert.match(source, /"app-server", "--listen", "stdio:\/\/"/);
  assert.match(source, /sandbox: "read-only"/);
  assert.match(source, /sandboxPolicy: \{ type: "readOnly" \}/);
  assert.match(source, /approvalPolicy: "never"/);
  assert.match(source, /effort: input\.effort \|\| null/);
  assert.doesNotMatch(source, /apiKey|accessToken|authorization|fetch\(/);
});

test("Codex 模型目录保留每个模型实际支持的推理强度", () => {
  const models = sanitizeCodexModelCatalog([
    {
      id: "gpt-test",
      displayName: "GPT Test",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "high", description: "Deep" },
      ],
    },
    { id: "hidden", hidden: true },
  ]);
  assert.equal(models.length, 1);
  assert.equal(models[0].defaultReasoningEffort, "high");
  assert.deepEqual(models[0].supportedReasoningEfforts.map((item) => item.reasoningEffort), ["low", "high"]);
});

test("AI 执行方式统一为 API、OpenCode 和 Codex", async () => {
  const catalog = await importWorkerModule("worker/domain/ai-task-catalog.ts");
  assert.deepEqual([...catalog.AI_EXECUTION_MODES], ["api", "opencode", "codex"]);
  assert.ok(catalog.AI_TASK_CATALOG.every((task) => ["api", "opencode", "codex"].includes(task.defaultExecutionMode)));
  const migration = readFileSync("drizzle/0012_ai_task_bindings.sql", "utf8");
  assert.match(migration, /IN \('api', 'opencode', 'codex'\)/);
  assert.match(migration, /engine_provider_id/);
  assert.match(migration, /engine_model_id/);
  assert.match(migration, /reasoning_effort/);
  assert.doesNotMatch(migration, /opencode_provider_id|codex_model_id|codex_reasoning_effort/);
  const localService = readFileSync("worker/services/local-runtime/managed.ts", "utf8");
  assert.doesNotMatch(localService, /settings\?\.default_(provider|model)/);
});

test("AI 任务持久化独立工作区、更新策略和权限档案", async () => {
  const catalog = await importWorkerModule("worker/domain/ai-task-catalog.ts");
  assert.ok(catalog.AI_TASK_CATALOG.every((task) => task.defaultWorkspaceMode));
  assert.ok(catalog.AI_TASK_CATALOG.every((task) => task.defaultUpdatePolicy));
  assert.ok(catalog.AI_TASK_CATALOG.every((task) => task.defaultPermissionProfileId));
  const migration = readFileSync("drizzle/0013_ai_task_execution_policies.sql", "utf8");
  assert.match(migration, /workspace_mode/);
  assert.match(migration, /ephemeral_worktree/);
  assert.doesNotMatch(migration, /'repository'/);
  assert.match(migration, /update_policy/);
  assert.match(migration, /permission_profile_id/);
  const transition = readFileSync("drizzle/0015_ephemeral_worktree_mode.sql", "utf8");
  assert.match(transition, /WHEN workspace_mode = 'repository' THEN 'ephemeral_worktree'/);
  const repository = readFileSync("worker/repositories/ai-task-bindings.ts", "utf8");
  assert.match(repository, /workspace_mode, update_policy, permission_profile_id/);
  for (const servicePath of ["managed", "community", "chat", "insight"]) {
    assert.match(
      readFileSync(`worker/services/local-runtime/${servicePath}.ts`, "utf8"),
      /\.\.\.localExecutionPolicy\(selection\)/,
    );
  }
});

test("Runner 配置使用嵌套引擎与仓库定义且不保留旧字段", () => {
  const config = loadRunnerConfig({
    LOONGBOARD_RUNNER_CONFIG: "/private/tmp/loongboard-no-runner-config.json",
  });
  assert.equal(config.engines.opencode.enabled, true);
  assert.equal(config.engines.codex.enabled, true);
  assert.ok(config.repositories.vllm.cloneUrl.endsWith("/vllm.git"));
  assert.deepEqual(config.allowedPermissionProfiles, ["safe_readonly", "community_research"]);
  assert.equal("opencodeUrl" in config, false);
  assert.equal("cloneUrls" in config, false);
});

test("本地分析入队 SQL 的列、参数与初始 Schema 一致", async () => {
  const migration = readFileSync("drizzle/0008_local_agent_runner.sql", "utf8");
  const repository = readFileSync("worker/repositories/local-runner.ts", "utf8");
  const table = migration.match(
    /CREATE TABLE IF NOT EXISTS local_analysis_jobs \(([\s\S]*?)\n\);/,
  )?.[1];
  const insert = repository.match(
    /INSERT INTO local_analysis_jobs\(([\s\S]*?)\) VALUES/,
  )?.[1];
  assert.ok(table, "local_analysis_jobs schema not found");
  assert.ok(insert, "enqueue local_analysis_jobs INSERT not found");
  const schemaColumns = new Set(
    table.split("\n")
      .map((line) => line.trim().match(/^([a-z_]+)\s/)?.[1])
      .filter(Boolean),
  );
  const insertedColumns = insert.split(",").map((column) => column.trim());
  assert.ok(insertedColumns.includes("engine_id"));
  assert.ok(!insertedColumns.includes("runner_engine"));
  assert.deepEqual(
    insertedColumns.filter((column) => !schemaColumns.has(column)),
    [],
  );
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            calls.push({ sql, params });
            return {
              run: async () => ({ success: true }),
              first: async () => null,
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    },
  };
  await localRunnerRepository.enqueueLocalAnalysisJob(env, {
    id: "job-1",
    userId: "user-1",
    jobType: "managed_ai_task",
    engineId: "codex",
    sessionScope: "managed:test",
    request: { purpose: "test" },
    createdAt: "2026-08-09T00:00:00.000Z",
  });
  const enqueue = calls.find((call) => call.sql.includes("INSERT INTO local_analysis_jobs"));
  assert.ok(enqueue);
  assert.equal(enqueue.params.length, (enqueue.sql.match(/\?/g) || []).length);
  assert.equal(enqueue.params[insertedColumns.indexOf("engine_id")], "codex");
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

test("权限档案独立控制只读、联网与 Worktree 编辑边界", () => {
  const safe = permissionProfile("safe_readonly");
  const research = permissionProfile("community_research");
  const development = permissionProfile("worktree_development");
  assert.equal(safe.tools.read, true);
  assert.equal(safe.tools.edit, false);
  assert.equal(safe.tools.webfetch, false);
  assert.equal(research.tools.webfetch, true);
  assert.equal(development.tools.edit, true);
  assert.ok(safe.permissions.some((rule) => rule.permission === "external_directory" && rule.action === "deny"));
  assert.ok(safe.permissions.some((rule) => rule.pattern === "**/.env*" && rule.action === "deny"));
  assert.throws(() => resolvePermissionPolicy(
    { request: { permissionProfileId: "worktree_development" } },
    { allowedPermissionProfiles: ["worktree_development"] },
    { workspaceMode: "none" },
    "opencode",
  ), /Worktree 工作区/);
  assert.equal(resolvePermissionPolicy(
    { request: { permissionProfileId: "worktree_development" } },
    { allowedPermissionProfiles: ["worktree_development"] },
    { workspaceMode: "ephemeral_worktree" },
    "opencode",
  ).id, "worktree_development");
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
  const source = [
    readFileSync("worker/services/local-runtime/insight.ts", "utf8"),
    readFileSync("worker/services/local-runtime/completion.ts", "utf8"),
  ].join("\n");
  assert.match(source, /if \(!input\.targets\.length\)/);
  assert.match(source, /sourceRead === true && codeReferences\.length > 0/);
});

test("本地 Agent 任务按统一能力契约校验", () => {
  const runner = {
    last_seen_at: "2026-08-01T00:00:10.000Z",
    readonly_verified: 1,
    engine_versions_json: JSON.stringify({ opencode: "1.0.0" }),
    engine_catalogs_json: JSON.stringify({
      opencode: { providers: [{ id: "provider", models: [{ id: "model" }] }] },
    }),
    capabilities_json: JSON.stringify({
      sessions: true,
      events: true,
      abort: true,
      worktrees: true,
      readonlyTools: ["read", "grep", "glob", "lsp"],
      engines: {
        opencode: {
          available: true,
          authenticated: true,
          capabilities: ["model_call"],
          permissionProfiles: ["safe_readonly"],
        },
      },
    }),
  };
  const validation = domain.validateLocalAgentRuntime({
    runner,
    engine: "opencode",
    jobType: "repository_chat",
    permissionProfileId: "safe_readonly",
    now: Date.parse("2026-08-01T00:00:20.000Z"),
  });
  assert.equal(validation.ok, true);
  assert.ok(domain.requiredCapabilitiesForLocalJob("repository_chat").includes("session_resume"));
  assert.equal(domain.localJobTypeForAITask("vllm_pr_deep_analysis"), "deep_analysis");
});

test("Worker 由共享引擎定义解析状态且不读取顶层兼容协议", () => {
  assert.deepEqual(
    domain.LOCAL_AGENT_ENGINE_DEFINITIONS.map((definition) => definition.id),
    [...domain.LOCAL_AGENT_ENGINES],
  );
  assert.equal(domain.localAgentEngineName("opencode"), "OpenCode");
  const states = domain.localAgentEngineStates({
    readonly_verified: 1,
    engine_versions_json: JSON.stringify({ codex: "1.2.3" }),
    engine_catalogs_json: JSON.stringify({
      codex: { providers: [{ id: "provider", models: [{ id: "model" }] }], models: [] },
    }),
    capabilities_json: JSON.stringify({
      codex: { available: true, authenticated: true },
      engines: {
        codex: {
          available: false,
          authenticated: false,
          capabilities: [],
          error: "disabled",
        },
      },
    }),
  });
  const codex = states.find((state) => state.engine === "codex");
  assert.equal(codex.available, false);
  assert.equal(codex.authenticated, false);
  assert.equal(codex.version, "1.2.3");
  assert.equal(codex.providers.length, 1);
  const source = readFileSync("worker/domain/local-analysis.ts", "utf8");
  assert.doesNotMatch(source, /rawCapabilities\.codex|state\.engine === "opencode"/);
  const taskSettings = readFileSync("worker/services/ai-task-settings.ts", "utf8");
  assert.match(taskSettings, /engineState\?\.providers\.length/);
  assert.doesNotMatch(taskSettings, /executionMode === "opencode"/);
  const execution = readFileSync("worker/services/ai-execution.ts", "utf8");
  assert.match(execution, /localAgentEngineName\(input\.task\.executionMode\)/);
  assert.doesNotMatch(execution, /executionMode === "codex"/);
});

test("模型选择按目录形状通用校验 Provider、Model 和推理强度", () => {
  const providerCatalog = {
    engine: "codex",
    available: true,
    authenticated: true,
    version: "1",
    capabilities: [],
    permissionProfiles: [],
    providers: [{ id: "provider", models: [{ id: "model" }] }],
    models: [],
    error: null,
  };
  assert.equal(domain.validateLocalAgentModelSelection({
    state: providerCatalog,
    providerId: "provider",
    modelId: "model",
  }).ok, true);
  assert.equal(domain.validateLocalAgentModelSelection({
    state: providerCatalog,
    providerId: "missing",
    modelId: "model",
  }).ok, false);
  const flatCatalog = {
    ...providerCatalog,
    engine: "opencode",
    providers: [],
    models: [{
      id: "reasoning-model",
      supportedReasoningEfforts: [{ reasoningEffort: "high" }],
    }],
  };
  assert.equal(domain.validateLocalAgentModelSelection({
    state: flatCatalog,
    modelId: "reasoning-model",
    reasoningEffort: "high",
  }).ok, true);
  assert.equal(domain.validateLocalAgentModelSelection({
    state: flatCatalog,
    modelId: "reasoning-model",
    reasoningEffort: "unsupported",
  }).ok, false);
});

test("本地 Agent 初始 Schema 只使用通用会话和引擎字段", () => {
  const migration = readFileSync("drizzle/0008_local_agent_runner.sql", "utf8");
  assert.match(migration, /agent_session_id/);
  assert.match(migration, /engine_session_bindings/);
  assert.match(migration, /engine_versions_json/);
  assert.doesNotMatch(migration, /CHECK\s*\(engine/);
  assert.doesNotMatch(migration, /opencode_(session_id|version|commit_sha)/);
  const repository = readFileSync("worker/repositories/local-runner.ts", "utf8");
  assert.match(repository, /agent_session_id = COALESCE/);
  assert.doesNotMatch(repository, /opencode_session_id/);
});

test("普通对话仅在任务明确绑定本地 Agent 时转换为本地队列", () => {
  const source = readFileSync("worker/routes/chat.ts", "utf8");
  const repositoryBranch = source.indexOf('if (body.mode === "repository")');
  const localEnqueue = source.indexOf("enqueueRepositoryChat", repositoryBranch);
  const normalAnswer = source.indexOf("answerChat", repositoryBranch);
  assert.ok(repositoryBranch > 0 && localEnqueue > repositoryBranch && normalAnswer > localEnqueue);
});

test("深度分析只由显式操作启动，并按任务配置选择 API 或本地 Agent", () => {
  const source = readFileSync("worker/routes/community.ts", "utf8");
  assert.match(source, /startCommunityDeepAnalysis/);
  assert.doesNotMatch(source, /analyzeCommunityItem\(/);
  assert.match(source, /getCommunityItem/);
});
