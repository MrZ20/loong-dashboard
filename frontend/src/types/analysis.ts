import type { LocalAgentEngine, LocalAgentEngineState } from "../../shared/contracts/local-agent";

export type { LocalAgentCapability, LocalAgentEngine, LocalAgentEngineState } from "../../shared/contracts/local-agent";

export type LocalAnalysisJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export type LocalExecutionEngineId = LocalAgentEngine;

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
  engineId?: LocalExecutionEngineId;
  agentSessionId?: string | null;
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
    engineVersions: Partial<Record<LocalExecutionEngineId, string>>;
    engines: LocalAgentEngineState[];
    readonlyVerified: boolean;
    repositories: Record<string, { configured: boolean; exists: boolean; git: boolean; head: string | null }>;
    activeJobs: number;
    lastSeenAt: string | null;
    lastError: string | null;
  };
}

export interface LocalExecutionEngineCapability {
  id: LocalExecutionEngineId;
  name: string;
  transport: string;
  available: boolean;
  authenticated: boolean;
  status: "ready" | "offline" | "unavailable";
  statusLabel: string;
  version: string | null;
  modelCount: number;
  error: string | null;
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
  engineId?: LocalExecutionEngineId;
  agentSessionId?: string | null;
  runnerJobId?: string | null;
  codeReferences?: CodeReference[];
  localEvidence?: boolean;
  createdAt: string;
  updatedAt: string;
}
