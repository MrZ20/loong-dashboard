CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  open_pull_count INTEGER NOT NULL DEFAULT 0,
  open_issue_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_items (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pr', 'issue')),
  number INTEGER NOT NULL,
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  author_avatar TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  html_url TEXT,
  comments INTEGER NOT NULL DEFAULT 0,
  domain TEXT NOT NULL DEFAULT 'Other',
  ai_summary TEXT NOT NULL DEFAULT '',
  status_text TEXT NOT NULL DEFAULT '',
  important INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  merged_at TEXT,
  fetched_at TEXT NOT NULL,
  diff_json TEXT,
  diff_files_count INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  UNIQUE(repo_id, kind, number),
  FOREIGN KEY(repo_id) REFERENCES repositories(id)
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '持续关注',
  note TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'P2',
  next_check TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, item_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(item_id) REFERENCES community_items(id)
);

CREATE TABLE IF NOT EXISTS analysis_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_md TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  created_by TEXT,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS domain_snapshots (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  architecture_md TEXT NOT NULL,
  changed_paths_json TEXT NOT NULL DEFAULT '[]',
  activity_json TEXT NOT NULL DEFAULT '{}',
  insight_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(domain, snapshot_date)
);

CREATE TABLE IF NOT EXISTS technical_documents (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  author_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_md TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(thread_id) REFERENCES chat_threads(id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  status TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY(repo_id) REFERENCES repositories(id)
);

CREATE INDEX IF NOT EXISTS community_repo_kind_updated_idx
  ON community_items(repo_id, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS community_domain_updated_idx
  ON community_items(domain, updated_at DESC);
CREATE INDEX IF NOT EXISTS analyses_type_updated_idx
  ON analysis_documents(type, updated_at DESC);
CREATE INDEX IF NOT EXISTS docs_category_updated_idx
  ON technical_documents(category, updated_at DESC);
CREATE INDEX IF NOT EXISTS messages_thread_created_idx
  ON chat_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS domain_snapshot_date_idx
  ON domain_snapshots(snapshot_date DESC);
