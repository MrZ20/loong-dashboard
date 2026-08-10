CREATE TABLE IF NOT EXISTS ai_task_bindings (
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
  PRIMARY KEY(user_id, task_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_task_bindings_provider_idx
  ON ai_task_bindings(user_id, provider_config_id);

CREATE INDEX IF NOT EXISTS ai_task_bindings_updated_idx
  ON ai_task_bindings(user_id, updated_at DESC);

PRAGMA optimize;
