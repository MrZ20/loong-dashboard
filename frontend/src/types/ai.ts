import type {
  AIExecutionMode,
  AIPermissionProfileId,
  AIUpdatePolicy,
  AIWorkspaceMode,
  AITaskKey,
} from "../../shared/contracts/ai";
import type { PromptFeatureKey } from "../../shared/contracts/prompts";
import type { LocalRunnerSettingsState } from "./analysis";

export type {
  AIExecutionMode,
  AIPermissionProfileId,
  AIUpdatePolicy,
  AIWorkspaceMode,
  AITaskKey,
} from "../../shared/contracts/ai";
export type { PromptFeatureKey } from "../../shared/contracts/prompts";

export interface AIPromptTemplate {
  id: string;
  featureKey: PromptFeatureKey;
  name: string;
  content: string;
  revision: number;
  isDefault: boolean;
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

export interface AIProviderConfig {
  id: string;
  name: string;
  providerType: "openai-compatible";
  baseUrl: string;
  apiMode: "responses" | "chat_completions";
  model: string;
  tokenConfigured: boolean;
  tokenHint: string;
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
  engineProviderId: string;
  engineModelId: string;
  reasoningEffort: string;
  workspaceMode: AIWorkspaceMode;
  updatePolicy: AIUpdatePolicy;
  permissionProfileId: AIPermissionProfileId;
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
