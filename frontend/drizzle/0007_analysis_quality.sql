ALTER TABLE community_items ADD COLUMN summary_prompt_type TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_model TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE community_items ADD COLUMN summary_structured_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE community_items ADD COLUMN summary_evidence_completeness TEXT NOT NULL DEFAULT 'insufficient';

ALTER TABLE analysis_documents ADD COLUMN prompt_type TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_documents ADD COLUMN body_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_documents ADD COLUMN files_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE analysis_documents ADD COLUMN analysis_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE analysis_documents ADD COLUMN evidence_completeness TEXT NOT NULL DEFAULT 'insufficient';

UPDATE community_items
SET summary_status = 'stale'
WHERE summary_source = 'ai'
  AND (
    (kind = 'pr' AND COALESCE(summary_prompt_version, '') != 'pr-code-summary-v2')
    OR
    (kind = 'issue' AND COALESCE(summary_prompt_version, '') != 'issue-summary-v2')
  );

PRAGMA optimize;
