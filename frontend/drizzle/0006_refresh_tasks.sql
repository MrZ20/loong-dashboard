CREATE TABLE IF NOT EXISTS refresh_task_configs (
  user_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (
    task_type IN ('facts', 'summary', 'classification', 'deep_analysis')
  ),
  auto_enabled INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER,
  active_range_hours INTEGER NOT NULL DEFAULT 168,
  refresh_rule TEXT NOT NULL,
  max_items INTEGER NOT NULL DEFAULT 20,
  include_ci_changes INTEGER NOT NULL DEFAULT 0,
  include_comment_changes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (
    status IN ('idle', 'queued', 'running', 'ready', 'failed')
  ),
  last_attempted_at TEXT,
  last_successful_at TEXT,
  watermark_updated_at TEXT,
  next_scheduled_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, repo_id, task_type),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_task_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (
    task_type IN ('facts', 'summary', 'classification', 'deep_analysis')
  ),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('manual', 'scheduled', 'initial')
  ),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (
    priority IN ('normal', 'high')
  ),
  item_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'ready', 'failed')
  ),
  base_watermark_at TEXT,
  committed_watermark_at TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(repo_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY(item_id) REFERENCES community_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS community_summary_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version_key TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (
    priority IN ('normal', 'high')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'ready', 'failed')
  ),
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(user_id, item_id, version_key, prompt_version),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(item_id) REFERENCES community_items(id) ON DELETE CASCADE
);

ALTER TABLE community_items ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE community_items ADD COLUMN base_sha TEXT;
ALTER TABLE community_items ADD COLUMN head_sha TEXT;
ALTER TABLE community_items ADD COLUMN merge_commit_sha TEXT;
ALTER TABLE community_items ADD COLUMN body_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN files_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN facts_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN facts_refreshed_at TEXT;
ALTER TABLE community_items ADD COLUMN body_changed_at TEXT;
ALTER TABLE community_items ADD COLUMN code_changed_at TEXT;
ALTER TABLE community_items ADD COLUMN any_changed_at TEXT;

ALTER TABLE community_items ADD COLUMN summary_status TEXT NOT NULL DEFAULT 'missing';
ALTER TABLE community_items ADD COLUMN summary_head_sha TEXT;
ALTER TABLE community_items ADD COLUMN summary_body_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_files_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_prompt_version TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_generated_at TEXT;
ALTER TABLE community_items ADD COLUMN summary_evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE community_items ADD COLUMN summary_error TEXT;

ALTER TABLE community_items ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'missing';
ALTER TABLE community_items ADD COLUMN classification_head_sha TEXT;
ALTER TABLE community_items ADD COLUMN classification_body_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN classification_files_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN classification_generated_at TEXT;
ALTER TABLE community_items ADD COLUMN classification_details_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE community_items ADD COLUMN classification_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_items ADD COLUMN classification_error TEXT;

ALTER TABLE community_items ADD COLUMN deep_analysis_status TEXT NOT NULL DEFAULT 'missing';
ALTER TABLE community_items ADD COLUMN deep_analysis_head_sha TEXT;

ALTER TABLE analysis_documents ADD COLUMN base_sha TEXT;
ALTER TABLE analysis_documents ADD COLUMN head_sha TEXT;
ALTER TABLE analysis_documents ADD COLUMN prompt_version TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_documents ADD COLUMN runner TEXT NOT NULL DEFAULT 'api';
ALTER TABLE analysis_documents ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_documents ADD COLUMN version_status TEXT NOT NULL DEFAULT 'current';

CREATE INDEX IF NOT EXISTS refresh_configs_due_idx
  ON refresh_task_configs(auto_enabled, next_scheduled_at);
CREATE INDEX IF NOT EXISTS refresh_runs_repo_task_started_idx
  ON refresh_task_runs(repo_id, task_type, started_at DESC);
CREATE INDEX IF NOT EXISTS summary_jobs_pending_idx
  ON community_summary_jobs(user_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS community_summary_status_updated_idx
  ON community_items(repo_id, summary_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS community_classification_status_updated_idx
  ON community_items(repo_id, classification_status, updated_at DESC);

PRAGMA optimize;
