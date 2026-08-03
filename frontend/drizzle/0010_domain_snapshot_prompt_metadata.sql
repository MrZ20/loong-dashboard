ALTER TABLE domain_snapshots ADD COLUMN prompt_template_id TEXT;
ALTER TABLE domain_snapshots ADD COLUMN prompt_template_name TEXT NOT NULL DEFAULT '';
ALTER TABLE domain_snapshots ADD COLUMN prompt_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domain_snapshots ADD COLUMN prompt_version TEXT NOT NULL DEFAULT '';
ALTER TABLE domain_snapshots ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE domain_snapshots ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE domain_snapshots ADD COLUMN generation_source TEXT NOT NULL DEFAULT 'rules';

PRAGMA optimize;
