ALTER TABLE ai_task_bindings ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'worktree'
  CHECK (workspace_mode IN ('none', 'ephemeral_worktree', 'worktree'));

ALTER TABLE ai_task_bindings ADD COLUMN update_policy TEXT NOT NULL DEFAULT 'none'
  CHECK (update_policy IN ('none', 'fetch'));

ALTER TABLE ai_task_bindings ADD COLUMN permission_profile_id TEXT NOT NULL DEFAULT 'safe_readonly'
  CHECK (permission_profile_id IN ('safe_readonly', 'community_research', 'worktree_development'));

PRAGMA optimize;
