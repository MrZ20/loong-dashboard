CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  active_ai_provider_id TEXT NOT NULL DEFAULT 'environment',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL DEFAULT 'openai-compatible',
  base_url TEXT NOT NULL,
  api_mode TEXT NOT NULL CHECK (api_mode IN ('responses', 'chat_completions')),
  model TEXT NOT NULL,
  encrypted_token TEXT NOT NULL DEFAULT '',
  token_hint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, name),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS ai_providers_user_updated_idx
  ON ai_providers(user_id, updated_at DESC);
