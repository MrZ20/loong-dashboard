import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importWorkerModule } from "./helpers/import-worker-module.mjs";

const execution = await importWorkerModule("src/domain/ai-execution.ts");

function runner(overrides = {}) {
  return {
    id: "runner-1",
    online: true,
    status: "ready",
    version: "1",
    engineVersions: { opencode: "2.0.0" },
    readonlyVerified: true,
    repositories: {},
    engines: [
      {
        engine: "opencode",
        available: true,
        authenticated: true,
        version: "2.0.0",
        capabilities: ["model_call", "repository_read"],
        providers: [{ id: "provider", name: "Provider", models: [{ id: "model", name: "Model" }] }],
        models: [{ id: "model", name: "Model" }],
        error: null,
      },
      {
        engine: "codex",
        available: true,
        authenticated: true,
        version: "",
        capabilities: ["model_call"],
        providers: [],
        models: [{ id: "codex-model", name: "Codex Model" }],
        error: null,
      },
    ],
    activeJobs: 0,
    lastSeenAt: null,
    lastError: null,
    ...overrides,
  };
}

test("任务执行引擎定义明确区分 API 与本地 Runner", () => {
  assert.equal(execution.executionEngineDefinition("api").requiresLocalRunner, false);
  assert.equal(execution.executionEngineDefinition("opencode").capabilityId, "opencode");
  assert.equal(execution.executionEngineDefinition("codex").capabilityId, "codex");
});

test("本地 Runner 以统一能力结构展示 OpenCode 与 Codex", () => {
  const capabilities = execution.localExecutionEngineCapabilities(runner());
  assert.deepEqual(capabilities.map(({ id, status, modelCount }) => ({ id, status, modelCount })), [
    { id: "opencode", status: "ready", modelCount: 1 },
    { id: "codex", status: "ready", modelCount: 1 },
  ]);
  assert.equal(capabilities[0].version, "2.0.0");
});

test("使用 Worker 提供的统一引擎状态", () => {
  const capabilities = execution.localExecutionEngineCapabilities(runner({
    engines: [
      {
        engine: "opencode",
        available: true,
        authenticated: true,
        version: "3.0.0",
        capabilities: ["model_call", "repository_read"],
        providers: [{ id: "engine-provider", name: "Engine Provider", models: [{ id: "engine-model", name: "Engine Model" }] }],
        models: [{ id: "engine-model", name: "Engine Model" }],
        error: null,
      },
      {
        engine: "codex",
        available: false,
        authenticated: false,
        version: "1.0.0",
        capabilities: [],
        providers: [],
        models: [],
        error: "not authenticated",
      },
    ],
  }));
  assert.equal(capabilities[0].version, "3.0.0");
  assert.equal(capabilities[0].modelCount, 1);
  assert.equal(capabilities[1].status, "unavailable");
  assert.equal(capabilities[1].error, "not authenticated");
});

test("引擎表单按统一状态选择 Provider 模型或顶层模型", () => {
  const providerState = runner().engines[0];
  assert.deepEqual(execution.localAgentProviders(providerState).map((provider) => provider.id), ["provider"]);

  const topLevelState = {
    ...runner().engines[1],
    models: [{
      id: "reasoning-model",
      name: "Reasoning Model",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Deep" }],
    }],
  };
  const [model] = execution.localAgentModels(topLevelState);
  assert.equal(model.id, "reasoning-model");
  assert.equal(model.defaultReasoningEffort, "high");
  assert.deepEqual(model.supportedReasoningEfforts, [{ reasoningEffort: "high", description: "Deep" }]);
});

test("每个本地 AI 任务配置工作区、更新策略和权限档案", () => {
  const panel = readFileSync("src/components/settings/AITaskSettingsPanel.vue", "utf8");
  assert.match(panel, /selectWorkspaceMode\(mode\.id\)/);
  assert.match(panel, /selectedAITask\.updatePolicy = 'fetch'/);
  assert.match(panel, /selectPermissionProfile\(profile\.id\)/);
  assert.match(panel, /permissionProfileOptions/);
  assert.match(panel, /每任务新建，结束即清理/);
  assert.match(panel, /成功、失败或取消后都会立即清理/);
  assert.match(panel, /提示词不能扩大权限/);
});
