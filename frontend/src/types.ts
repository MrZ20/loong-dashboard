export type RepositoryId = "vllm" | "vllm-ascend";
export type CommunityKind = "pr" | "issue";
export type CommunityState = "open" | "merged" | "closed" | "draft";
export type AppTab = "pulls" | "issues" | "analysis";
export type AppView =
  | AppTab
  | "insights"
  | "watchlist"
  | "impact"
  | "domains"
  | "docs"
  | "chat";
export type ThemeMode = "light" | "dark";
export type ImpactLevel = "low" | "medium" | "high" | "critical";
export type AIInsightKind = "risk" | "upstream" | "trend" | "collaboration";
export type AIInsightSeverity = "critical" | "high" | "medium" | "low";
export type AdaptationStatus =
  | "unreviewed"
  | "possibly_affected"
  | "needs_adaptation"
  | "in_progress"
  | "adapted"
  | "not_applicable";

export interface DiffStat {
  files: number;
  additions: number;
  deletions: number;
  entries: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
  raw?: string;
  source?: "raw-diff" | "files-api";
  complete?: boolean;
  notice?: string;
}

export interface CommunityItem {
  id: number;
  repo: RepositoryId;
  kind: CommunityKind;
  state: CommunityState;
  title: string;
  author: string;
  time: string;
  statusText: string;
  domain: string;
  summary: string;
  body: string;
  bodyMd?: string;
  htmlUrl?: string | null;
  comments: number;
  important?: boolean;
  diff?: DiffStat;
  deepAnalysis: {
    overview: string;
    impact: string;
    risks: string[];
    suggestions: string[];
  };
}

export interface RepositoryMeta {
  id: RepositoryId;
  owner: string;
  name: string;
  description: string;
  stars: string;
  openPulls: number;
  openIssues: number;
  lastSyncedAt?: string | null;
  syncStatus?: string;
}

export interface WatchlistMeta {
  reason: string;
  note: string;
  priority: "P0" | "P1" | "P2" | "P3";
  nextCheck: string;
}

export interface CrossRepoImpact {
  id: string;
  source: {
    repo: RepositoryId;
    kind: CommunityKind;
    number: number;
    title: string;
  };
  domain: string;
  level: ImpactLevel;
  status: AdaptationStatus;
  analysis: string;
  changedPaths: string[];
  ascendPaths: string[];
  relatedItem?: string;
}

export interface DomainMapStage {
  label: string;
  repository: string;
  paths: string[];
  symbols: string[];
}

export interface DomainMap {
  id: string;
  name: string;
  description: string;
  pipelinePosition: string;
  keywords: string[];
  activity: {
    pulls: number;
    issues: number;
    risks: number;
    trend: "升温" | "稳定" | "降温";
  };
  stages: DomainMapStage[];
  currentWork: string[];
  insight: string;
}

export interface AIInsight {
  id: string;
  kind: AIInsightKind;
  severity: AIInsightSeverity;
  title: string;
  summary: string;
  domain: string;
  confidence: number;
  sources: string[];
  action: string;
  window: "24h" | "7d";
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  mode: "chatgpt" | "development";
}

export interface AnalysisDocument {
  id: string;
  type: string;
  scope: string;
  title: string;
  summaryMd: string;
  contentMd: string;
  prompt: string;
  model: string;
  status: string;
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TechnicalDocument {
  id: string;
  category: string;
  slug: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  contentMd: string;
  context?: Record<string, unknown>;
  createdAt: string;
}

export interface DomainMapApi {
  id: string;
  name: string;
  description: string;
  pipeline: string;
  stages: DomainMapStage[];
  activity: {
    pulls: number;
    issues: number;
    risks: number;
    trend: string;
    latestChange: string | null;
  };
  changedPaths: string[];
  changes: Array<{
    id: string;
    repo: RepositoryId;
    kind: CommunityKind;
    number: number;
    title: string;
    updatedAt: string;
  }>;
  snapshot: {
    date: string;
    architectureMd: string;
    insightMd: string;
    changedPaths: string[];
  } | null;
}
