ALTER TABLE community_items ADD COLUMN created_at TEXT;
ALTER TABLE community_items ADD COLUMN closed_at TEXT;
ALTER TABLE community_items ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_items ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_input_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_source TEXT NOT NULL DEFAULT 'excerpt';
ALTER TABLE community_items ADD COLUMN summary_updated_at TEXT;

CREATE TABLE IF NOT EXISTS community_events (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'opened', 'updated', 'draft', 'ready_for_review',
      'merged', 'closed', 'reopened'
    )
  ),
  occurred_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'sync',
  actor TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(item_id, event_type, occurred_at),
  FOREIGN KEY(repo_id) REFERENCES repositories(id),
  FOREIGN KEY(item_id) REFERENCES community_items(id)
);

CREATE TABLE IF NOT EXISTS cross_repo_impacts (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL,
  target_repo_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL CHECK (
    status IN (
      'unreviewed', 'possibly_affected', 'needs_adaptation',
      'in_progress', 'adapted', 'not_applicable'
    )
  ),
  analysis TEXT NOT NULL,
  changed_paths_json TEXT NOT NULL DEFAULT '[]',
  target_paths_json TEXT NOT NULL DEFAULT '[]',
  related_item_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  generated_by TEXT NOT NULL DEFAULT 'rules',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_item_id, target_repo_id),
  FOREIGN KEY(source_item_id) REFERENCES community_items(id),
  FOREIGN KEY(target_repo_id) REFERENCES repositories(id),
  FOREIGN KEY(related_item_id) REFERENCES community_items(id)
);

CREATE INDEX IF NOT EXISTS community_events_repo_occurred_idx
  ON community_events(repo_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS community_events_item_occurred_idx
  ON community_events(item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS impacts_target_updated_idx
  ON cross_repo_impacts(target_repo_id, updated_at DESC);
