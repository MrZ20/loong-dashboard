import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRunnerPrompt } from "../local-runner/prompts.mjs";

test("repository-level classification refresh is queued while single-item refresh stays direct", () => {
  const source = readFileSync("worker/routes/api.ts", "utf8");
  assert.match(source, /if \(!itemId\) \{\s+const run = await queueRefreshTask/);
  assert.match(source, /run: await runRefreshTask[\s\S]+itemId/);
});

test("classification refresh reports progress and bounds repository-level concurrency", () => {
  const source = readFileSync("worker/services/classification-refresh.ts", "utf8");
  assert.match(source, /stage: "classifying"/);
  assert.match(source, /Math\.min\(6, rows\.length\)/);
  assert.match(source, /resolvedTask \?\?= resolveAITask/);
});

test("single-item updates are propagated to the list without a page reload", () => {
  const detail = readFileSync("src/composables/useCommunityDetail.ts", "utf8");
  const workspace = readFileSync("src/composables/useCommunityWorkspace.ts", "utf8");
  const app = readFileSync("src/App.vue", "utf8");
  assert.match(detail, /onItemUpdated\(result\.item\)/);
  assert.match(workspace, /function upsertCommunityItem\(item: CommunityItem\)/);
  assert.match(app, /useCommunityDetail\(showToast, upsertCommunityItem\)/);
});

test("taxonomy refresh reuses an active job and runs from a bounded evidence pack", () => {
  const service = readFileSync("worker/services/classification-taxonomies.ts", "utf8");
  assert.match(service, /findActiveLocalAnalysisJob/);
  assert.match(service, /if \(activeJob\) return \{ job: mapLocalJob\(activeJob\), taxonomy: null \}/);
  assert.match(service, /workspaceMode: "none"/);
  assert.match(service, /evidenceOnly: true/);

  const prompt = buildRunnerPrompt({
    jobType: "managed_ai_task",
    subjectKind: "taxonomy",
    subjectKey: "vllm-ascend:refresh",
    repoScope: "vllm-ascend",
    request: {
      purpose: "taxonomy_refresh",
      prompt: { templateName: "default", revision: 1, instruction: "只应用有近期证据支持的分类规则增量。" },
    },
  }, {
    commits: { "vllm-ascend": "abc123" },
    worktrees: { "vllm-ascend": "/tmp/worktree" },
  }, []);
  assert.match(prompt.prompt, /数据库证据包模式/);
  assert.match(prompt.prompt, /业务判断要求只来自当前绑定的提示词/);
  assert.match(prompt.prompt, /不得调用读取、搜索、Shell、Git、LSP、联网或其他工具/);
});

test("AI taxonomy refresh exposes resumable progress and cancellation", () => {
  const panel = readFileSync("src/components/settings/AITaskSettingsPanel.vue", "utf8");
  const styles = readFileSync("src/styles/settings.css", "utf8");
  assert.match(panel, /localActionProgress/);
  assert.match(panel, /resumeTaxonomyAction/);
  assert.match(panel, /cancelTaxonomyRefresh/);
  assert.match(panel, /role="progressbar"/);
  assert.match(panel, /不会自动重跑已有 PR\/Issue 标签/);
  assert.match(panel, /enforceTaxonomyEvidencePolicy/);
  assert.match(panel, /数据库证据包/);
  assert.match(panel, /通过本地 Runner 分析数据库证据包/);
  assert.match(panel, /不 Fetch · 不创建 Worktree · 不访问源码/);
  assert.match(panel, /v-else-if="selectedAITask.executionMode !== 'api'"/);
  assert.match(panel, /class="button button--secondary"[\s\S]+更新分类标准[\s\S]+class="button button--primary"[\s\S]+新增模板/);
  assert.match(styles, /\.taxonomy-run-progress__track/);
  assert.match(styles, /\.taxonomy-evidence-policy/);
  assert.match(styles, /\.settings-card > header > \.prompt-header-actions[\s\S]+flex-direction: row/);
});
