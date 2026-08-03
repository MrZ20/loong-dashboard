CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, feature_key, name),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_prompt_preferences (
  user_id TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  active_template_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, feature_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(active_template_id) REFERENCES ai_prompt_templates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ai_prompt_templates_user_feature_updated_idx
  ON ai_prompt_templates(user_id, feature_key, updated_at DESC);

ALTER TABLE analysis_documents ADD COLUMN prompt_template_id TEXT;
ALTER TABLE analysis_documents ADD COLUMN prompt_template_name TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_documents ADD COLUMN prompt_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE community_items ADD COLUMN summary_prompt_template_id TEXT;
ALTER TABLE community_items ADD COLUMN summary_prompt_revision INTEGER NOT NULL DEFAULT 1;

PRAGMA optimize;
