ALTER TABLE community_items
ADD COLUMN domain_source TEXT NOT NULL DEFAULT 'text';

ALTER TABLE community_items
ADD COLUMN domain_confidence REAL NOT NULL DEFAULT 0;

ALTER TABLE community_items
ADD COLUMN domain_evidence_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE community_items
ADD COLUMN review_signal_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE community_items
ADD COLUMN review_signal_updated_at TEXT;
