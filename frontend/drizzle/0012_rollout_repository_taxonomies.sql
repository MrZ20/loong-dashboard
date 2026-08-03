UPDATE community_items
SET classification_status = 'missing',
    classification_error = NULL
WHERE classification_locked = 0;

UPDATE refresh_task_configs
SET max_items = CASE WHEN max_items < 500 THEN 500 ELSE max_items END,
    status = 'idle',
    next_scheduled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_error = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE task_type = 'classification'
  AND auto_enabled = 1;

PRAGMA optimize;
