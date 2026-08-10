export const PROMPT_FEATURE_KEYS = [
  "pr_triage",
  "issue_triage",
  "pr_deep_analysis",
  "issue_deep_analysis",
  "vllm_classification",
  "vllm_ascend_classification",
  "vllm_taxonomy_refresh",
  "vllm_ascend_taxonomy_refresh",
  "daily_report",
  "domain_architecture_map",
  "technical_document_generation",
  "cross_repo_insight",
  "local_code_insight",
  "chat_assistant",
  "repository_code_chat",
] as const;

export type PromptFeatureKey = (typeof PROMPT_FEATURE_KEYS)[number];
