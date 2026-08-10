import type {
  AdaptationStatus,
  ImpactLevel,
  RepositoryId,
} from "./core";
import type { RefreshTaskState } from "./refresh";

export type CommunityKind = "pr" | "issue";
export type CommunityState = "open" | "merged" | "closed" | "draft";

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
  source?:
    | "pull-metadata"
    | "graphql-files"
    | "files-api-stat"
    | "raw-diff"
    | "files-api";
  complete?: boolean;
  statsOnly?: boolean;
  notice?: string;
}

export interface DomainAssessment {
  domain: string;
  source: "files" | "files+text" | "text" | "fallback" | "ai";
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  matchedPaths: string[];
  matchedTerms: string[];
  scores: Array<{
    domain: string;
    score: number;
    sourceLines?: number;
    sourceHits?: number;
    codeownerHits?: number;
    codeownerSpecificity?: number;
    testHits?: number;
    labelHits?: number;
    titleHits?: number;
    bodyHits?: number;
    linkedHits?: number;
  }>;
  taxonomyVersion?: string;
  matchedCodeownerRules?: string[];
}

export interface ReviewSignal {
  action: "ready" | "attention" | "waiting" | "blocked" | "complete" | "unknown";
  label: string;
  summary: string;
  score: number;
  completeness: "full" | "partial";
  ciStatus: "success" | "failure" | "pending" | "unknown";
  checks: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    details: Array<{
      name: string;
      status: "success" | "failure" | "pending" | "neutral";
      url?: string;
    }>;
  };
  mergeability: "mergeable" | "conflicting" | "unknown";
  mergeState: string;
  reviewDecision: "approved" | "changes_requested" | "review_required" | "unknown";
  behindBy: number | null;
  changedFiles: number;
  additions: number;
  deletions: number;
  reasons: string[];
  source: "github-graphql" | "github-rest" | "metadata";
  updatedAt: string;
}

export interface CommunityItem {
  id: number;
  repo: RepositoryId;
  kind: CommunityKind;
  state: CommunityState;
  title: string;
  author: string;
  time: string;
  updatedAt?: string;
  statusText: string;
  domain: string;
  summary: string;
  summarySource?: "ai" | "excerpt";
  summaryUpdatedAt?: string | null;
  factsRefreshedAt?: string | null;
  labels?: string[];
  baseSha?: string | null;
  headSha?: string | null;
  mergeCommitSha?: string | null;
  summaryStatus?: "missing" | "queued" | "running" | "ready" | "stale" | "failed";
  summaryVersion?: {
    headSha: string | null;
    bodyHash: string;
    filesHash: string;
    promptType: string;
    promptVersion: string;
    promptTemplateId: string | null;
    promptRevision: number;
    model: string;
    provider: string;
    source: "ai" | "excerpt";
    evidenceCompleteness: "complete" | "partial" | "insufficient";
    structured: Record<string, unknown>;
    generatedAt: string | null;
    evidence: string[];
    error: string | null;
  };
  classificationStatus?:
    | "missing"
    | "queued"
    | "running"
    | "ready"
    | "possibly_stale"
    | "failed";
  classificationVersion?: {
    headSha: string | null;
    bodyHash: string;
    filesHash: string;
    generatedAt: string | null;
    locked: boolean;
    details: Record<string, unknown>;
    error: string | null;
  };
  deepAnalysisStatus?: "missing" | "running" | "ready" | "outdated" | "failed";
  deepAnalysisHeadSha?: string | null;
  body: string;
  bodyMd?: string;
  htmlUrl?: string | null;
  comments: number;
  important?: boolean;
  lastEventType?: "opened" | "updated" | "draft" | "ready_for_review" | "merged" | "closed" | "reopened" | null;
  lastEventAt?: string | null;
  domainAssessment?: DomainAssessment;
  reviewSignal?: ReviewSignal | null;
  reviewSignalUpdatedAt?: string | null;
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
  refreshTasks?: RefreshTaskState[];
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
  evidence?: string[];
  generatedBy?: "rules" | "ai";
  relatedItem?: string | {
    repo: RepositoryId;
    kind: CommunityKind;
    number: number;
    title: string;
  } | null;
  updatedAt?: string;
}

export interface TodaySummary {
  date: string;
  start: string;
  end: string;
  timezone: "Asia/Shanghai";
  repo: RepositoryId;
  headline: string;
  topDomain: string;
  counts: {
    opened: number;
    updated: number;
    draft: number;
    readyForReview: number;
    merged: number;
    closed: number;
    reopened: number;
  };
  importantChanges: number;
  riskCount: number;
  events: Array<{
    id: string;
    type: string;
    label: string;
    occurredAt: string;
    beijingTime: string;
    source: string;
    item: {
      id: string;
      kind: CommunityKind;
      number: number;
      title: string;
      domain: string;
      important: boolean;
      state: CommunityState;
      htmlUrl?: string | null;
    };
  }>;
}
