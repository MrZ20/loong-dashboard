export type RepositoryId = string;
export type AppTab = "pulls" | "issues" | "analysis";
export type AppView =
  | AppTab
  | "insights"
  | "watchlist"
  | "impact"
  | "domains"
  | "docs"
  | "chat"
  | "settings";
export type ThemeMode = "light" | "dark";
export type ImpactLevel = "low" | "medium" | "high" | "critical";
export type AdaptationStatus =
  | "unreviewed"
  | "possibly_affected"
  | "needs_adaptation"
  | "in_progress"
  | "adapted"
  | "not_applicable";
