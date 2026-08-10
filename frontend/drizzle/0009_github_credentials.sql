CREATE TABLE IF NOT EXISTS github_credentials (
  user_id TEXT PRIMARY KEY,
  encrypted_token TEXT NOT NULL,
  token_hint TEXT NOT NULL DEFAULT '',
  verified_login TEXT NOT NULL DEFAULT '',
  rate_limit_remaining INTEGER,
  rate_limit_limit INTEGER,
  rate_limit_reset_at TEXT,
  graphql_rate_limit_remaining INTEGER,
  graphql_rate_limit_limit INTEGER,
  graphql_rate_limit_reset_at TEXT,
  rate_limit_checked_at TEXT,
  last_verified_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

PRAGMA optimize;
