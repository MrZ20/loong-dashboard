CREATE TABLE ai_task_bindings_next (
  user_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  execution_mode TEXT NOT NULL DEFAULT 'api'
    CHECK (execution_mode IN ('api', 'opencode', 'codex')),
  provider_config_id TEXT NOT NULL DEFAULT 'environment',
  engine_provider_id TEXT NOT NULL DEFAULT '',
  engine_model_id TEXT NOT NULL DEFAULT '',
  reasoning_effort TEXT NOT NULL DEFAULT '',
  prompt_template_id TEXT,
  last_run_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'never'
    CHECK (last_status IN ('never', 'queued', 'running', 'ready', 'failed')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  workspace_mode TEXT NOT NULL DEFAULT 'worktree'
    CHECK (workspace_mode IN ('none', 'ephemeral_worktree', 'worktree')),
  update_policy TEXT NOT NULL DEFAULT 'none'
    CHECK (update_policy IN ('none', 'fetch')),
  permission_profile_id TEXT NOT NULL DEFAULT 'safe_readonly'
    CHECK (permission_profile_id IN ('safe_readonly', 'community_research', 'worktree_development')),
  PRIMARY KEY(user_id, task_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO ai_task_bindings_next(
  user_id, task_key, execution_mode, provider_config_id,
  engine_provider_id, engine_model_id, reasoning_effort,
  prompt_template_id, last_run_at, last_status, last_error,
  created_at, updated_at, workspace_mode, update_policy,
  permission_profile_id
)
SELECT
  user_id, task_key, execution_mode, provider_config_id,
  engine_provider_id, engine_model_id, reasoning_effort,
  prompt_template_id, last_run_at, last_status, last_error,
  created_at, updated_at,
  CASE
    WHEN workspace_mode = 'repository' THEN 'ephemeral_worktree'
    ELSE workspace_mode
  END,
  update_policy, permission_profile_id
FROM ai_task_bindings;

DROP TABLE ai_task_bindings;
ALTER TABLE ai_task_bindings_next RENAME TO ai_task_bindings;

CREATE INDEX ai_task_bindings_provider_idx
  ON ai_task_bindings(user_id, provider_config_id);

CREATE INDEX ai_task_bindings_updated_idx
  ON ai_task_bindings(user_id, updated_at DESC);

PRAGMA optimize;
