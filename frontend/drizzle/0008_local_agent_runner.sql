CREATE TABLE IF NOT EXISTS local_runner_settings (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  worktree_retention_hours INTEGER NOT NULL DEFAULT 24,
  auto_fetch INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER NOT NULL DEFAULT 900,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS local_runners (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  version TEXT NOT NULL DEFAULT '',
  engine_versions_json TEXT NOT NULL DEFAULT '{}',
  auth_configured INTEGER NOT NULL DEFAULT 0,
  readonly_verified INTEGER NOT NULL DEFAULT 0,
  repositories_json TEXT NOT NULL DEFAULT '{}',
  engine_catalogs_json TEXT NOT NULL DEFAULT '{}',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  active_jobs INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_analysis_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  subject_kind TEXT NOT NULL DEFAULT '',
  subject_key TEXT NOT NULL DEFAULT '',
  repo_scope TEXT NOT NULL DEFAULT '',
  item_id TEXT,
  chat_thread_id TEXT,
  analysis_document_id TEXT,
  session_scope TEXT NOT NULL DEFAULT '',
  base_sha TEXT,
  head_sha TEXT,
  target_ref TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  engine_id TEXT NOT NULL,
  agent_session_id TEXT,
  runner_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 50,
  request_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  local_evidence INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(chat_thread_id) REFERENCES chat_threads(id),
  FOREIGN KEY(analysis_document_id) REFERENCES analysis_documents(id)
);

CREATE TABLE IF NOT EXISTS local_analysis_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(job_id, sequence),
  FOREIGN KEY(job_id) REFERENCES local_analysis_jobs(id)
);

CREATE TABLE IF NOT EXISTS engine_session_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_scope TEXT NOT NULL,
  repo_scope TEXT NOT NULL DEFAULT '',
  commit_sha TEXT NOT NULL DEFAULT '',
  engine_id TEXT NOT NULL,
  agent_session_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  summary_md TEXT NOT NULL DEFAULT '',
  confirmed_facts_json TEXT NOT NULL DEFAULT '[]',
  unresolved_json TEXT NOT NULL DEFAULT '[]',
  focus_json TEXT NOT NULL DEFAULT '[]',
  worktree_state TEXT NOT NULL DEFAULT 'rebuildable',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, session_scope, commit_sha, engine_id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

ALTER TABLE analysis_documents ADD COLUMN agent_session_id TEXT;
ALTER TABLE analysis_documents ADD COLUMN runner_job_id TEXT;
ALTER TABLE analysis_documents ADD COLUMN code_references_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE analysis_documents ADD COLUMN local_evidence INTEGER NOT NULL DEFAULT 0;

ALTER TABLE chat_threads ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE chat_threads ADD COLUMN repo_scope TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN target_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN agent_session_id TEXT;
ALTER TABLE chat_threads ADD COLUMN agent_commit_sha TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_threads ADD COLUMN runner_job_id TEXT;
ALTER TABLE chat_threads ADD COLUMN local_evidence INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_local_jobs_queue
  ON local_analysis_jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_local_jobs_user_updated
  ON local_analysis_jobs(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_events_job_sequence
  ON local_analysis_events(job_id, sequence ASC);
CREATE INDEX IF NOT EXISTS idx_local_runners_user_seen
  ON local_runners(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_engine_binding_scope
  ON engine_session_bindings(user_id, session_scope, commit_sha, engine_id);

PRAGMA optimize;
