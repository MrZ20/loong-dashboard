UPDATE ai_task_bindings
SET workspace_mode = 'none', update_policy = 'none', permission_profile_id = 'safe_readonly'
WHERE task_key IN (
  'vllm_daily_report', 'vllm_ascend_daily_report', 'cross_repo_insight',
  'technical_document_generation', 'chat_assistant'
);

UPDATE ai_task_bindings
SET workspace_mode = 'ephemeral_worktree', update_policy = 'none', permission_profile_id = 'safe_readonly'
WHERE task_key IN (
  'vllm_issue_summary', 'vllm_ascend_issue_summary',
  'vllm_issue_deep_analysis', 'vllm_ascend_issue_deep_analysis',
  'vllm_classification', 'vllm_ascend_classification', 'repository_code_chat'
);

UPDATE ai_task_bindings
SET workspace_mode = 'worktree', update_policy = 'fetch', permission_profile_id = 'safe_readonly'
WHERE task_key IN (
  'vllm_pr_summary', 'vllm_ascend_pr_summary',
  'vllm_pr_deep_analysis', 'vllm_ascend_pr_deep_analysis',
  'domain_architecture_map'
);

UPDATE ai_task_bindings
SET workspace_mode = 'ephemeral_worktree', update_policy = 'fetch', permission_profile_id = 'community_research'
WHERE task_key IN ('vllm_taxonomy_refresh', 'vllm_ascend_taxonomy_refresh');

UPDATE ai_task_bindings
SET workspace_mode = 'worktree', update_policy = 'fetch', permission_profile_id = 'community_research'
WHERE task_key = 'local_code_insight';

PRAGMA optimize;
