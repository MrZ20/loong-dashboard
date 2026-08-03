import type { PromptFeatureKey } from "./prompt-catalog";

export const AI_EXECUTION_MODES = [
  "environment",
  "account_api",
  "opencode",
] as const;

export type AIExecutionMode = (typeof AI_EXECUTION_MODES)[number];

export const AI_TASK_KEYS = [
  "vllm_pr_summary",
  "vllm_issue_summary",
  "vllm_pr_deep_analysis",
  "vllm_issue_deep_analysis",
  "vllm_classification",
  "vllm_taxonomy_refresh",
  "vllm_daily_report",
  "vllm_ascend_pr_summary",
  "vllm_ascend_issue_summary",
  "vllm_ascend_pr_deep_analysis",
  "vllm_ascend_issue_deep_analysis",
  "vllm_ascend_classification",
  "vllm_ascend_taxonomy_refresh",
  "vllm_ascend_daily_report",
  "cross_repo_insight",
  "local_code_insight",
  "domain_architecture_map",
  "technical_document_generation",
  "chat_assistant",
  "repository_code_chat",
] as const;

export type AITaskKey = (typeof AI_TASK_KEYS)[number];
export type AITaskGroupKey =
  | "vllm"
  | "vllm-ascend"
  | "insights"
  | "knowledge"
  | "chat";

export interface AITaskDefinition {
  key: AITaskKey;
  groupKey: AITaskGroupKey;
  groupName: string;
  name: string;
  description: string;
  repoScope: "vllm" | "vllm-ascend" | "global";
  featureKey: PromptFeatureKey;
  defaultExecutionMode: AIExecutionMode;
  executionNote: string;
}

function repoTasks(
  repo: "vllm" | "vllm-ascend",
  prefix: "vllm" | "vllm_ascend",
): AITaskDefinition[] {
  const groupName = repo === "vllm" ? "vLLM" : "vLLM-Ascend";
  const classification = repo === "vllm"
    ? "vllm_classification"
    : "vllm_ascend_classification";
  const taxonomyRefresh = repo === "vllm"
    ? "vllm_taxonomy_refresh"
    : "vllm_ascend_taxonomy_refresh";
  return [
    {
      key: `${prefix}_pr_summary` as AITaskKey,
      groupKey: repo,
      groupName,
      name: "PR 摘要",
      description: "代码摘要、证据和结构化结论。",
      repoScope: repo,
      featureKey: "pr_triage",
      defaultExecutionMode: "environment",
      executionNote: "只分析数据库中缺失或过期的 PR 摘要。",
    },
    {
      key: `${prefix}_issue_summary` as AITaskKey,
      groupKey: repo,
      groupName,
      name: "Issue 摘要",
      description: "现象、环境、影响和待确认项。",
      repoScope: repo,
      featureKey: "issue_triage",
      defaultExecutionMode: "environment",
      executionNote: "只分析数据库中缺失或过期的 Issue 摘要。",
    },
    {
      key: `${prefix}_pr_deep_analysis` as AITaskKey,
      groupKey: repo,
      groupName,
      name: "PR 深度分析",
      description: "实现、调用链、兼容性、风险和测试分析。",
      repoScope: repo,
      featureKey: "pr_deep_analysis",
      defaultExecutionMode: "opencode",
      executionNote: "始终由用户手动启动；OpenCode 使用只读 Worktree。",
    },
    {
      key: `${prefix}_issue_deep_analysis` as AITaskKey,
      groupKey: repo,
      groupName,
      name: "Issue 深度分析",
      description: "根因假设、代码证据和验证方案。",
      repoScope: repo,
      featureKey: "issue_deep_analysis",
      defaultExecutionMode: "opencode",
      executionNote: "始终由用户手动启动；不会因打开详情而运行。",
    },
    {
      key: `${prefix}_classification` as AITaskKey,
      groupKey: repo,
      groupName,
      name: "技术分类补判",
      description: "仅在规则结果低置信度时补充一个主技术领域。",
      repoScope: repo,
      featureKey: classification,
      defaultExecutionMode: "environment",
      executionNote: "代码规则优先，AI 不能覆盖人工锁定分类。",
    },
    {
      key: `${prefix}_taxonomy_refresh` as AITaskKey,
      groupKey: repo,
      groupName,
      name: "分类标准更新",
      description: "根据近期真实路径审查分类规则覆盖。",
      repoScope: repo,
      featureKey: taxonomyRefresh,
      defaultExecutionMode: "environment",
      executionNote: "新类别只形成建议，不会自动进入 domain。",
    },
    {
      key: `${prefix}_daily_report` as AITaskKey,
      groupKey: repo,
      groupName,
      name: "今日分析",
      description: "北京时间自然日的仓库 Markdown 日报。",
      repoScope: repo,
      featureKey: "daily_report",
      defaultExecutionMode: "environment",
      executionNote: "只读取已同步社区事实；不会隐式刷新 GitHub。",
    },
  ];
}

export const AI_TASK_CATALOG: readonly AITaskDefinition[] = [
  ...repoTasks("vllm", "vllm"),
  ...repoTasks("vllm-ascend", "vllm_ascend"),
  {
    key: "cross_repo_insight",
    groupKey: "insights",
    groupName: "AI 洞察",
    name: "跨仓库洞察",
    description: "综合社区事项、关注列表和跨仓库影响。",
    repoScope: "global",
    featureKey: "cross_repo_insight",
    defaultExecutionMode: "environment",
    executionNote: "选择 OpenCode 时必须明确选择本地代码核对目标。",
  },
  {
    key: "local_code_insight",
    groupKey: "insights",
    groupName: "AI 洞察",
    name: "本地代码证据洞察",
    description: "对用户选择的重点事项读取本地代码证据。",
    repoScope: "global",
    featureKey: "local_code_insight",
    defaultExecutionMode: "opencode",
    executionNote: "只扫描用户明确选择的社区事项或领域。",
  },
  {
    key: "domain_architecture_map",
    groupKey: "knowledge",
    groupName: "技术知识",
    name: "技术领域架构地图",
    description: "维护领域架构基线、技术结构图与每日变化。",
    repoScope: "global",
    featureKey: "domain_architecture_map",
    defaultExecutionMode: "environment",
    executionNote: "稳定架构基线与北京时间今日变化分开生成。",
  },
  {
    key: "technical_document_generation",
    groupKey: "knowledge",
    groupName: "技术知识",
    name: "技术文档生成",
    description: "根据分类、草稿和来源生成可人工确认的 Markdown 文档。",
    repoScope: "global",
    featureKey: "technical_document_generation",
    defaultExecutionMode: "environment",
    executionNote: "只生成编辑器草稿；用户确认前不会保存或覆盖技术文档。",
  },
  {
    key: "chat_assistant",
    groupKey: "chat",
    groupName: "AI 对话",
    name: "普通对话",
    description: "基于对话、页面上下文和选中文本回答。",
    repoScope: "global",
    featureKey: "chat_assistant",
    defaultExecutionMode: "environment",
    executionNote: "选择 OpenCode 会明确转换为仓库分析模式。",
  },
  {
    key: "repository_code_chat",
    groupKey: "chat",
    groupName: "AI 对话",
    name: "仓库分析对话",
    description: "通过 OpenCode Session 连续进行只读代码问答。",
    repoScope: "global",
    featureKey: "repository_code_chat",
    defaultExecutionMode: "opencode",
    executionNote: "保留 Session；切换代码版本后创建新的代码上下文。",
  },
] as const;

const taskDefinitions = new Map(
  AI_TASK_CATALOG.map((definition) => [definition.key, definition]),
);

export function isAITaskKey(value: unknown): value is AITaskKey {
  return typeof value === "string" && taskDefinitions.has(value as AITaskKey);
}

export function isAIExecutionMode(value: unknown): value is AIExecutionMode {
  return typeof value === "string" && AI_EXECUTION_MODES.includes(value as AIExecutionMode);
}

export function getAITaskDefinition(key: AITaskKey) {
  return taskDefinitions.get(key)!;
}

export function aiTaskKeyForFeature(
  featureKey: PromptFeatureKey,
  repoScope = "global",
): AITaskKey {
  const prefix = repoScope === "vllm-ascend" ? "vllm_ascend" : "vllm";
  if (featureKey === "pr_triage") return `${prefix}_pr_summary` as AITaskKey;
  if (featureKey === "issue_triage") return `${prefix}_issue_summary` as AITaskKey;
  if (featureKey === "pr_deep_analysis") return `${prefix}_pr_deep_analysis` as AITaskKey;
  if (featureKey === "issue_deep_analysis") return `${prefix}_issue_deep_analysis` as AITaskKey;
  if (featureKey === "daily_report") return `${prefix}_daily_report` as AITaskKey;
  if (featureKey === "vllm_classification") return "vllm_classification";
  if (featureKey === "vllm_ascend_classification") return "vllm_ascend_classification";
  if (featureKey === "vllm_taxonomy_refresh") return "vllm_taxonomy_refresh";
  if (featureKey === "vllm_ascend_taxonomy_refresh") return "vllm_ascend_taxonomy_refresh";
  return featureKey;
}
