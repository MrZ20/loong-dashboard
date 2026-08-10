import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

test("community workspace loads one server-filtered page at a time", () => {
  const workspace = readFileSync("src/composables/useCommunityWorkspace.ts", "utf8");
  const communityApi = readFileSync("src/api/community.ts", "utf8");
  const facts = readFileSync("worker/services/facts-refresh.ts", "utf8");
  assert.doesNotMatch(workspace, /matchingItems,[\s\S]{0,100}slice\(0, 30\)/);
  assert.match(workspace, /communityApi\.communityPage\(communityPageQuery/);
  assert.doesNotMatch(workspace, /communityApi\.communityAll/);
  assert.doesNotMatch(communityApi, /offset \+= COMMUNITY_PAGE_SIZE/);
  assert.doesNotMatch(facts, /Math\.min\(countByKind\.get\("pr"\)/);
  assert.match(facts, /批量社区事实刷新需要 GitHub Token/);
});

test("local-code prompts resolve through centralized AI tasks", () => {
  const localService = [
    readFileSync("worker/services/local-runtime/enqueue.ts", "utf8"),
    readFileSync("worker/services/local-runtime/chat.ts", "utf8"),
    readFileSync("worker/services/local-runtime/insight.ts", "utf8"),
  ].join("\n");
  assert.doesNotMatch(localService, /local-code-insight-v1/);
  assert.match(localService, /resolveAITask\([\s\S]*"repository_code_chat"/);
  assert.match(localService, /task\.prompt/);
});

test("local Agent runtime separates enqueue, completion, and mapping contracts", () => {
  assert.ok(readFileSync("worker/services/local-runtime/enqueue.ts", "utf8").length > 0);
  assert.ok(readFileSync("worker/services/local-runtime/completion.ts", "utf8").length > 0);
  assert.ok(readFileSync("worker/services/local-runtime/mappers.ts", "utf8").length > 0);
});

test("classification taxonomy persistence has repository-scoped overlay metadata", () => {
  const migration = readFileSync(
    "drizzle/0011_repository_classification_taxonomies.sql",
    "utf8",
  );
  assert.match(migration, /PRIMARY KEY\(user_id, repo_id\)/);
  assert.match(migration, /overlay_json/);
  assert.match(migration, /analysis_md/);
});

test("settings routes delegate persistence instead of embedding SQL", () => {
  for (const route of ["worker/routes/settings-account.ts", "worker/routes/settings-ai.ts"]) {
    const source = readFileSync(route, "utf8");
    assert.doesNotMatch(source, /\b(SELECT|INSERT|UPDATE|DELETE\s+FROM)\b/i, route);
  }
  assert.match(readFileSync("worker/repositories/accounts.ts", "utf8"), /SELECT users\.\*/);
  assert.match(readFileSync("worker/repositories/ai-providers.ts", "utf8"), /SELECT \* FROM ai_providers/);
});

test("service modules delegate SQL to repositories", () => {
  for (const file of readdirSync("worker/services").filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(`worker/services/${file}`, "utf8");
    assert.doesNotMatch(
      source,
      /`[^`]*\b(SELECT|INSERT INTO|UPDATE [a-z_]|DELETE FROM)\b/i,
      file,
    );
  }
});

test("initial schema does not recreate removed sync storage", () => {
  assert.doesNotMatch(
    readFileSync("drizzle/0001_initial.sql", "utf8"),
    /CREATE TABLE IF NOT EXISTS sync_runs/,
  );
});

test("settings exposes AI management without legacy model and prompt-center pages", () => {
  const source = readFileSync("src/components/SettingsView.vue", "utf8");
  const taskSettings = readFileSync("src/components/settings/AITaskSettingsPanel.vue", "utf8");
  const engineContracts = readFileSync("shared/contracts/local-agent.ts", "utf8");
  const runnerSettings = readFileSync("src/components/settings/LocalRunnerSettingsPanel.vue", "utf8");
  const accountSettings = readFileSync("src/components/settings/AccountSettingsPanel.vue", "utf8");
  const providerSettings = readFileSync("src/components/settings/AIProviderSettingsPanel.vue", "utf8");
  const refreshSettings = readFileSync("src/components/settings/CommunityRefreshSettingsPanel.vue", "utf8");
  const settingsModules = [
    source,
    taskSettings,
    runnerSettings,
    accountSettings,
    providerSettings,
    refreshSettings,
  ].join("\n");
  const styles = readFileSync("src/styles/settings.css", "utf8");
  assert.match(source, /AI 管理/);
  assert.match(source, /AI 配置/);
  assert.match(engineContracts, /LOCAL_AGENT_ENGINE_DEFINITIONS/);
  assert.doesNotMatch(taskSettings, /OpenCode|Codex|executionMode === ["'](?:opencode|codex)["']/);
  assert.match(source, /本地运行环境/);
  assert.doesNotMatch(providerSettings, /activateAIProvider|provider\.active|providerForm\.makeActive|兼容默认/);
  assert.doesNotMatch(settingsModules, /AI 模型/);
  assert.doesNotMatch(settingsModules, /提示词中心/);
  assert.doesNotMatch(settingsModules, /默认 Provider/);
  assert.doesNotMatch(settingsModules, /默认 Model/);
  assert.match(source, /visitedTabs/);
  assert.match(accountSettings, /onMounted\(loadAccountSettings\)/);
  assert.match(providerSettings, /onMounted\(loadProviders\)/);
  assert.match(refreshSettings, /onMounted\(loadRefreshSettings\)/);
  assert.match(taskSettings, /v-if="notice"/);
  assert.match(runnerSettings, /v-if="runnerNotice"/);
  assert.match(taskSettings, /推理强度/);
  assert.match(taskSettings, /supportedReasoningEfforts/);
  assert.match(styles, /\.ai-task-config-fields input,\s*\.ai-task-config-fields select/);
  assert.match(styles, /\.settings-context-notice\[data-kind="error"\]/);
  assert.match(styles, /\.prompt-feature-item \{[\s\S]*width: 100%;[\s\S]*min-height: 56px/);
  assert.match(styles, /\.local-runner-metrics \{[^}]*repeat\(5,/);
  assert.match(
    readFileSync("drizzle/0012_ai_task_bindings.sql", "utf8"),
    /PRIMARY KEY\(user_id, task_key\)/,
  );
  const documentSource = readFileSync("src/components/TechnicalDocsView.vue", "utf8");
  assert.match(documentSource, /AI 生成草稿/);
  assert.match(documentSource, /technical_document_generation/);
});

test("all business prompts are persisted, editable, nonempty, and exact-bound", () => {
  const migration = readFileSync("drizzle/0016_editable_default_prompts.sql", "utf8");
  const catalog = readFileSync("worker/domain/prompt-catalog.ts", "utf8");
  const resolution = readFileSync("worker/services/prompt-resolution.ts", "utf8");
  const management = readFileSync("worker/services/prompt-management.ts", "utf8");
  const panel = readFileSync("src/components/settings/AITaskSettingsPanel.vue", "utf8");

  assert.match(migration, /content TEXT NOT NULL CHECK\(length\(trim\(content\)\) > 0\)/);
  assert.match(migration, /is_default INTEGER NOT NULL/);
  assert.match(migration, /is_seed INTEGER NOT NULL/);
  assert.match(migration, /DROP TABLE IF EXISTS ai_prompt_preferences/);
  assert.match(migration, /DELETE FROM ai_task_bindings/);
  assert.doesNotMatch(catalog, /defaultInstruction|defaultName|builtInPromptId/);
  assert.match(resolution, /selectedTemplateId === null \|\| selectedTemplateId === ""/);
  assert.match(resolution, /绑定的提示词不存在/);
  assert.doesNotMatch(resolution, /fallback|builtin:/i);
  assert.match(management, /existing\.is_default/);
  assert.match(management, /默认提示词不能删除/);
  assert.match(panel, /默认模板 · 可编辑/);
  assert.match(panel, /aria-label="编辑提示词"/);
  assert.match(panel, /v-if="!template\.isDefault"[^>]+aria-label=/);
});

test("frontend imports bounded API and type modules without aggregate facades", () => {
  assert.equal(existsSync("src/api/client.ts"), false);
  assert.equal(existsSync("src/types.ts"), false);
  for (const file of readdirSync("src", { recursive: true }).filter((name) => /\.(ts|vue)$/.test(name))) {
    const source = readFileSync(`src/${file}`, "utf8");
    assert.doesNotMatch(source, /from ["'](?:\.\.?\/)+types["']/, file);
    assert.doesNotMatch(source, /api\/client/, file);
    assert.doesNotMatch(
      source,
      /opencodeProviderId|opencodeModelId|codexModelId|codexReasoningEffort/,
      file,
    );
  }
});

test("AI outputs render execution configuration, model, and prompt metadata", () => {
  const footer = readFileSync("src/components/AIExecutionFooter.vue", "utf8");
  assert.match(footer, /本次 AI 执行/);
  assert.match(footer, /<small>配置<\/small>/);
  assert.match(footer, /<small>模型<\/small>/);
  assert.match(footer, /<small>提示词<\/small>/);
  for (const file of [
    "src/components/DetailDrawer.vue",
    "src/components/AnalysisDocumentWorkspace.vue",
    "src/components/DomainMapView.vue",
    "src/components/AIChatMessages.vue",
    "src/components/TechnicalDocsView.vue",
  ]) {
    assert.match(readFileSync(file, "utf8"), /AIExecutionFooter/);
  }
  const chatRoute = readFileSync("worker/routes/chat.ts", "utf8");
  assert.match(chatRoute, /promptVersion: result\.prompt\.promptVersion/);
  assert.match(chatRoute, /context: \{[\s\S]*?executionMode: "api"[\s\S]*?model: result\.model/);
});

test("summary detail polling covers long-running local analysis", () => {
  const detail = readFileSync("src/composables/useCommunityDetail.ts", "utf8");
  assert.match(detail, /SUMMARY_POLL_TIMEOUT_MS = 15 \* 60_000/);
  assert.match(detail, /Date\.now\(\) < pollDeadline/);
});

test("settings refresh completion reloads global repository counts", () => {
  const settings = readFileSync("src/components/settings/CommunityRefreshSettingsPanel.vue", "utf8");
  const app = readFileSync("src/App.vue", "utf8");
  const workspace = readFileSync("src/composables/useCommunityWorkspace.ts", "utf8");
  assert.match(settings, /emit\("refresh-complete", pending\.repoId, pending\.taskType\)/);
  assert.match(settings, /emit\("refresh-complete", task\.repoId, task\.taskType\)/);
  assert.match(app, /@refresh-complete="handleSettingsRefreshComplete"/);
  assert.match(app, /await reloadCommunitySnapshot\(repoId\)/);
  assert.match(workspace, /async function reloadCommunitySnapshot\(repoId: RepositoryId\)/);
});

test("domain snapshots persist prompt and model version metadata", () => {
  const migration = readFileSync(
    "drizzle/0010_domain_snapshot_prompt_metadata.sql",
    "utf8",
  );
  const source = readFileSync("worker/services/domain-maps.ts", "utf8");
  assert.match(migration, /prompt_template_id/);
  assert.match(migration, /prompt_version/);
  assert.match(migration, /generation_source/);
  assert.match(source, /generateDomainMapDocument/);
  assert.match(source, /generated\.prompt\.promptVersion/);
});

test("summary refresh qualifies joined D1 columns to avoid ambiguous id", () => {
  const source = readFileSync("worker/repositories/summaries.ts", "utf8");
  assert.match(source, /community_items\.id = \?/);
  assert.match(source, /community_items\.updated_at >= \?/);
  assert.match(source, /ORDER BY community_items\.updated_at DESC/);
  assert.doesNotMatch(source, /\bOR id = \?/);
});

test("GitHub credentials are encrypted and account scoped", () => {
  const migration = readFileSync("drizzle/0009_github_credentials.sql", "utf8");
  const route = readFileSync("worker/routes/settings-github.ts", "utf8");
  const service = readFileSync("worker/services/github-settings.ts", "utf8");
  assert.match(migration, /user_id TEXT PRIMARY KEY/);
  assert.match(migration, /encrypted_token TEXT NOT NULL/);
  assert.match(service, /encryptCredential\(env, token\)/);
  assert.match(service, /withUserGithubToken/);
  assert.doesNotMatch(route, /encrypted_token/);
});

test("GitHub quota tracks REST and GraphQL resources independently", () => {
  const service = readFileSync("worker/services/github-settings.ts", "utf8");
  const facts = readFileSync("worker/services/facts-refresh.ts", "utf8");
  const settings = readFileSync("src/components/settings/CommunityRefreshSettingsPanel.vue", "utf8");
  const migration = readFileSync("drizzle/0009_github_credentials.sql", "utf8");
  assert.match(service, /resources\?: \{ core\?: GithubRateResource; graphql\?: GithubRateResource \}/);
  assert.match(service, /export async function refreshGithubRateLimits/);
  assert.match(facts, /refreshGithubRateLimits\(env, input\.userId\)/);
  assert.match(settings, /GraphQL 额度/);
  assert.match(settings, /额度更新时间/);
  assert.match(migration, /graphql_rate_limit_remaining/);
  assert.match(migration, /rate_limit_checked_at/);
});

test("repository-level refreshes use queue progress and lease contracts", () => {
  const route = readFileSync("worker/routes/api.ts", "utf8");
  const migration = readFileSync("drizzle/0006_refresh_tasks.sql", "utf8");
  assert.match(route, /if \(!itemId\)/);
  assert.match(route, /queueRefreshTask/);
  assert.match(route, /context\.waitUntil\(execution\.catch/);
  assert.match(route, /status: 202/);
  assert.match(route, /runRefreshTask/);
  assert.match(migration, /current_stage TEXT NOT NULL/);
  assert.match(migration, /progress_current INTEGER NOT NULL/);
  assert.match(migration, /lease_expires_at TEXT/);
  assert.match(migration, /refresh_runs_queue_lease_idx/);
});

test("local development service actively drives the Worker scheduled handler", () => {
  const packageJson = readFileSync("package.json", "utf8");
  const localService = readFileSync("scripts/dev-service.mjs", "utf8");
  const worker = readFileSync("worker/index.ts", "utf8");
  assert.match(packageJson, /node scripts\/dev-service\.mjs/);
  assert.match(localService, /--test-scheduled/);
  assert.match(localService, /\/__scheduled/);
  assert.match(localService, /setInterval\(runScheduledRefresh, scheduleIntervalMs\)/);
  assert.match(worker, /scheduled[\s\S]+runDueRefreshTasks/);
});

test("summary refresh packages state and domain filter persistence", () => {
  const migration = readFileSync("drizzle/0006_refresh_tasks.sql", "utf8");
  const candidates = readFileSync("worker/repositories/summaries.ts", "utf8");
  const summaryHandler = readFileSync(
    "worker/services/refresh-handlers/summary.ts",
    "utf8",
  );
  assert.match(migration, /state_filter TEXT NOT NULL/);
  assert.match(migration, /domain_filter TEXT NOT NULL/);
  assert.match(candidates, /community_items\.state = \?/);
  assert.match(candidates, /community_items\.domain = \?/);
  assert.match(summaryHandler, /stateFilter: config\.state_filter/);
  assert.match(summaryHandler, /domainFilter: config\.domain_filter/);
});

test("analysis quality schema adds structured summary metadata without data rewrites", () => {
  const migration = readFileSync("drizzle/0007_analysis_quality.sql", "utf8");
  assert.match(migration, /summary_structured_json/);
  assert.doesNotMatch(migration, /UPDATE community_items/);
});
