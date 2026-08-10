export const AI_EXECUTION_MODES = ["api", "opencode", "codex"] as const;

export type AIExecutionMode = (typeof AI_EXECUTION_MODES)[number];

export const AI_WORKSPACE_MODES = ["none", "ephemeral_worktree", "worktree"] as const;
export type AIWorkspaceMode = (typeof AI_WORKSPACE_MODES)[number];

export const AI_UPDATE_POLICIES = ["none", "fetch"] as const;
export type AIUpdatePolicy = (typeof AI_UPDATE_POLICIES)[number];

export const AI_PERMISSION_PROFILE_DEFINITIONS = [
  {
    id: "safe_readonly",
    name: "安全只读",
    description: "读取、搜索、LSP 与受限 Git 查询；不联网、不修改源码。",
    engines: ["opencode", "codex"],
  },
  {
    id: "community_research",
    name: "社区检索",
    description: "在安全只读基础上允许网页检索及只读 gh 查询。",
    engines: ["opencode"],
  },
  {
    id: "worktree_development",
    name: "隔离开发",
    description: "仅在独立 Worktree 中允许编辑和受限验证；禁止提交、推送和破坏性 Git 操作。",
    engines: ["opencode"],
  },
] as const;

export type AIPermissionProfileId =
  (typeof AI_PERMISSION_PROFILE_DEFINITIONS)[number]["id"];

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
