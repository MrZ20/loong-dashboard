export const REFRESH_TASK_TYPES = [
  "facts",
  "summary",
  "classification",
  "deep_analysis",
] as const;

export type RefreshTaskType = (typeof REFRESH_TASK_TYPES)[number];

export type RefreshRule =
  | "updated_since_success"
  | "code_only"
  | "code_or_body"
  | "any_update"
  | "first_only"
  | "manual";

export type RefreshTaskStatus =
  | "idle"
  | "queued"
  | "running"
  | "ready"
  | "failed";

export type RefreshStateFilter =
  | "all"
  | "open"
  | "draft"
  | "merged"
  | "closed";
