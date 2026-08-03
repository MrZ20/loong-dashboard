export type RepositoryId = string;
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
  | "chat"
  | "settings";
export type ThemeMode = "light" | "dark";
export type RefreshTaskType = "facts" | "summary" | "classification" | "deep_analysis";
export type RefreshRule =
  | "updated_since_success"
  | "code_only"
  | "code_or_body"
  | "any_update"
  | "first_only"
  | "manual";
export type PromptFeatureKey =
  | "pr_triage"
  | "issue_triage"
  | "pr_deep_analysis"
  | "issue_deep_analysis"
  | "vllm_classification"
  | "vllm_ascend_classification"
  | "vllm_taxonomy_refresh"
  | "vllm_ascend_taxonomy_refresh"
  | "daily_report"
  | "domain_architecture_map"
  | "technical_document_generation"
  | "cross_repo_insight"
  | "local_code_insight"
  | "chat_assistant"
  | "repository_code_chat";
export type AIExecutionMode = "environment" | "account_api" | "opencode";
export type AITaskKey =
  | "vllm_pr_summary"
  | "vllm_issue_summary"
  | "vllm_pr_deep_analysis"
  | "vllm_issue_deep_analysis"
  | "vllm_classification"
  | "vllm_taxonomy_refresh"
  | "vllm_daily_report"
  | "vllm_ascend_pr_summary"
  | "vllm_ascend_issue_summary"
  | "vllm_ascend_pr_deep_analysis"
  | "vllm_ascend_issue_deep_analysis"
  | "vllm_ascend_classification"
  | "vllm_ascend_taxonomy_refresh"
  | "vllm_ascend_daily_report"
  | "cross_repo_insight"
  | "local_code_insight"
  | "domain_architecture_map"
  | "technical_document_generation"
  | "chat_assistant"
  | "repository_code_chat";
export type ImpactLevel = "low" | "medium" | "high" | "critical";
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
  action:
    | "ready"
    | "attention"
    | "waiting"
    | "blocked"
    | "complete"
    | "unknown";
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
  reviewDecision:
    | "approved"
    | "changes_requested"
    | "review_required"
    | "unknown";
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
    model: string;
    provider: string;
    source: "ai" | "excerpt";
    evidenceCompleteness: "complete" | "partial" | "insufficient";
    structured: Record<string, unknown>;
    generatedAt: string | null;
    evidence: string[];
    error: string | null;
  };
  classificationStatus?: "missing" | "ready" | "possibly_stale" | "failed";
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
  lastEventType?:
    | "opened"
    | "updated"
    | "draft"
    | "ready_for_review"
    | "merged"
    | "closed"
    | "reopened"
    | null;
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

export type LocalAnalysisJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export interface LocalAnalysisEvent {
  id: number;
  jobId: string;
  sequence: number;
  eventType: string;
  source: "runner" | "git" | "opencode" | "system" | string;
  level: "info" | "warning" | "error";
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LocalAnalysisJob {
  id: string;
  jobType: string;
  subjectKind: string;
  subjectKey: string;
  repoScope: string;
  itemId: string | null;
  chatThreadId: string | null;
  analysisDocumentId: string | null;
  sessionScope: string;
  baseSha: string | null;
  headSha: string | null;
  targetRef: string;
  providerId: string;
  modelId: string;
  status: LocalAnalysisJobStatus;
  localEvidence: boolean;
  error: string | null;
  result: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface LocalRunnerSettingsState {
  settings: {
    enabled: boolean;
    defaultProvider: string;
    defaultModel: string;
    maxConcurrency: number;
    worktreeRetentionHours: number;
    autoFetch: boolean;
    timeoutSeconds: number;
  };
  runner: {
    id: string | null;
    online: boolean;
    status: string;
    version: string;
    opencodeVersion: string;
    authConfigured: boolean;
    readonlyVerified: boolean;
    repositories: Record<string, { configured: boolean; exists: boolean; git: boolean; head: string | null }>;
    providers: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>;
    capabilities: Record<string, unknown>;
    activeJobs: number;
    lastSeenAt: string | null;
    lastError: string | null;
  };
}

export interface GitHubCredentialState {
  configured: boolean;
  source: "account" | "environment" | "none";
  tokenHint: string;
  verifiedLogin: string;
  rateLimitRemaining: number | null;
  rateLimitLimit: number | null;
  rateLimitResetAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

export interface CodeReference {
  repository: "vllm" | "vllm-ascend";
  commitSha: string;
  path: string;
  symbol: string;
  startLine: number | null;
  endLine: number | null;
  reason: string;
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

export interface RefreshTaskState {
  repoId: string;
  taskType: RefreshTaskType;
  autoEnabled: boolean;
  intervalMinutes: number | null;
  activeRangeHours: number;
  refreshRule: RefreshRule;
  maxItems: number;
  includeCiChanges: boolean;
  includeCommentChanges: boolean;
  status: "idle" | "queued" | "running" | "ready" | "failed";
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  watermarkUpdatedAt: string | null;
  nextScheduledAt: string | null;
  lastError: string | null;
  pendingCount: number;
  stale: boolean;
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
  relatedItem?:
    | string
    | {
        repo: RepositoryId;
        kind: CommunityKind;
        number: number;
        title: string;
      }
    | null;
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

export interface DomainMapStage {
  label: string;
  repository: string;
  responsibility?: string;
  paths: string[];
  symbols: string[];
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
  promptTemplateId: string | null;
  promptTemplateName: string;
  promptRevision: number;
  model: string;
  baseSha: string | null;
  headSha: string | null;
  bodyHash: string;
  filesHash: string;
  promptType: string;
  promptVersion: string;
  runner: string;
  provider: string;
  analysisSource: "ai" | "unknown";
  evidenceCompleteness: "complete" | "partial" | "insufficient";
  versionStatus: "current" | "outdated";
  status: string;
  sourceRefs: string[];
  opencodeSessionId?: string | null;
  runnerJobId?: string | null;
  codeReferences?: CodeReference[];
  localEvidence?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AIPromptTemplate {
  id: string;
  featureKey: PromptFeatureKey;
  name: string;
  content: string;
  revision: number;
  builtIn: boolean;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AIPromptFeature {
  key: PromptFeatureKey;
  name: string;
  description: string;
  group: "社区条目" | "分类管理" | "分析文档" | "交互助手";
  contextSources: string[];
  promptVersion: string;
  activeTemplateId: string;
  templates: AIPromptTemplate[];
}

export interface ClassificationTaxonomyState {
  repoId: "vllm" | "vllm-ascend";
  repositoryName: string;
  baseVersion: string;
  effectiveVersion: string;
  evidenceRevision: string;
  status: "running" | "ready" | "failed";
  lastRefreshedAt: string | null;
  lastError: string | null;
  analysisMd: string;
  promptTemplateName: string;
  categories: Array<{
    id: string;
    name: string;
    description: string;
    sourcePathCount: number;
    testPathCount: number;
  }>;
  newDomainProposals: Array<{
    id: string;
    name: string;
    rationale: string;
    evidence: string[];
  }>;
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

export interface ChatThread {
  id: string;
  title: string;
  context?: Record<string, unknown>;
  mode?: "normal" | "repository";
  repoScope?: string;
  targetRef?: string;
  providerId?: string;
  modelId?: string;
  opencodeSessionId?: string | null;
  opencodeCommitSha?: string;
  runnerJobId?: string | null;
  localEvidence?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  organization: string;
  bio: string;
  current: boolean;
  lastSeenAt: string;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  providerType: "openai-compatible";
  baseUrl: string;
  apiMode: "responses" | "chat_completions";
  model: string;
  tokenConfigured: boolean;
  tokenHint: string;
  active: boolean;
  builtIn: boolean;
  usageCount?: number;
  usedBy?: AITaskKey[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AITaskSetting {
  key: AITaskKey;
  groupKey: "vllm" | "vllm-ascend" | "insights" | "knowledge" | "chat";
  groupName: string;
  name: string;
  description: string;
  repoScope: "vllm" | "vllm-ascend" | "global";
  featureKey: PromptFeatureKey;
  executionNote: string;
  executionMode: AIExecutionMode;
  providerConfigId: string;
  opencodeProviderId: string;
  opencodeModelId: string;
  promptTemplateId: string;
  promptTemplateName: string;
  promptRevision: number;
  lastRunAt: string | null;
  lastStatus: "never" | "queued" | "running" | "ready" | "failed";
  lastError: string | null;
  persisted: boolean;
}

export interface AITaskGroup {
  key: AITaskSetting["groupKey"];
  name: string;
  tasks: AITaskSetting[];
}

export interface AIManagementState {
  groups: AITaskGroup[];
  runner: LocalRunnerSettingsState["runner"];
}

export interface DomainMapApi {
  id: string;
  name: string;
  description: string;
  pipeline: string;
  taxonomyDomains: {
    vllm: string[];
    "vllm-ascend": string[];
  };
  architecture: {
    source: "maintained-baseline";
    executionFlow: Array<{
      id: string;
      label: string;
      order: number;
    }>;
    updatedByDailyActivity: false;
  };
  stages: DomainMapStage[];
  activity: {
    window: "7d";
    pulls: number;
    issues: number;
    risks: number;
    trend: string;
    latestChange: string | null;
  };
  today: {
    date: string;
    timezone: "Asia/Shanghai";
    changedPaths: string[];
    changes: Array<{
      id: string;
      eventId: string;
      eventType: string;
      repo: RepositoryId;
      kind: CommunityKind;
      number: number;
      title: string;
      updatedAt: string;
      occurredAt: string;
    }>;
  };
  snapshot: {
    date: string;
    architectureMd: string;
    insightMd: string;
    changedPaths: string[];
    promptTemplateId: string | null;
    promptTemplateName: string;
    promptRevision: number;
    promptVersion: string;
    model: string;
    provider: string;
    generationSource: "api" | "fallback" | "rules" | string;
    createdAt: string;
  } | null;
}
