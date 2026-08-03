CREATE TABLE IF NOT EXISTS classification_taxonomy_overrides (
  user_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  base_taxonomy_version TEXT NOT NULL,
  overlay_version TEXT NOT NULL,
  overlay_json TEXT NOT NULL DEFAULT '{"domains":[]}',
  analysis_md TEXT NOT NULL DEFAULT '',
  prompt_template_id TEXT,
  prompt_template_name TEXT NOT NULL DEFAULT '',
  prompt_revision INTEGER NOT NULL DEFAULT 0,
  prompt_version TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('running', 'ready', 'failed')),
  last_error TEXT,
  last_refreshed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, repo_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(repo_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS classification_taxonomy_repo_updated_idx
  ON classification_taxonomy_overrides(repo_id, updated_at DESC);

PRAGMA optimize;
