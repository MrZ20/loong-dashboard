import type {
  AIProviderConfig,
  AIManagementState,
  AIExecutionMode,
  AIPermissionProfileId,
  AIUpdatePolicy,
  AIWorkspaceMode,
  AITaskKey,
  AIPromptFeature,
  ClassificationTaxonomyState,
  PromptFeatureKey,
} from "../types/ai";
import type {
  RefreshRule,
  RefreshTaskState,
  RefreshTaskType,
} from "../types/refresh";
import type {
  AuthUser,
  UserAccount,
  GitHubCredentialState,
} from "../types/account";
import type { LocalAnalysisJob } from "../types/analysis";
import { apiFetch } from "./core";

export const settingsApi = {
  githubSettings: () =>
    apiFetch<{ github: GitHubCredentialState }>("/api/settings/github"),

  saveGithubToken: (token: string) =>
    apiFetch<{ github: GitHubCredentialState }>("/api/settings/github", {
      method: "PUT",
      body: JSON.stringify({ token }),
    }),

  testGithubToken: () =>
    apiFetch<{ github: GitHubCredentialState }>("/api/settings/github/test", {
      method: "POST",
    }),

  deleteGithubToken: () =>
    apiFetch<{ github: GitHubCredentialState }>("/api/settings/github", {
      method: "DELETE",
    }),

  profile: () =>
    apiFetch<{ profile: UserAccount; mode: AuthUser["mode"] }>(
      "/api/settings/profile",
    ),

  updateProfile: (input: {
    displayName: string;
    role: string;
    organization: string;
    bio: string;
  }) =>
    apiFetch<{ profile: UserAccount }>("/api/settings/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  accounts: () =>
    apiFetch<{ accounts: UserAccount[]; canAdd: boolean }>(
      "/api/settings/accounts",
    ),

  createAccount: (input: {
    email: string;
    displayName: string;
    role?: string;
    organization?: string;
  }) =>
    apiFetch<{ account: UserAccount }>("/api/settings/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  switchAccount: (accountId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/settings/accounts/${encodeURIComponent(accountId)}/switch`,
      { method: "POST" },
    ),

  aiProviders: () =>
    apiFetch<{ providers: AIProviderConfig[] }>(
      "/api/settings/ai-providers",
    ),

  aiManagement: () =>
    apiFetch<AIManagementState>("/api/settings/ai-management"),

  updateAITask: (
    taskKey: AITaskKey,
    input: {
      executionMode: AIExecutionMode;
      providerConfigId: string;
      engineProviderId: string;
      engineModelId: string;
      reasoningEffort: string;
      workspaceMode: AIWorkspaceMode;
      updatePolicy: AIUpdatePolicy;
      permissionProfileId: AIPermissionProfileId;
      promptTemplateId: string;
    },
  ) =>
    apiFetch<{ task: unknown }>(
      `/api/settings/ai-tasks/${encodeURIComponent(taskKey)}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),

  testAITask: (taskKey: AITaskKey) =>
    apiFetch<{ ok: boolean; message: string }>(
      `/api/settings/ai-tasks/${encodeURIComponent(taskKey)}/test`,
      { method: "POST" },
    ),

  clearAITaskError: (taskKey: AITaskKey) =>
    apiFetch<{ ok: boolean }>(
      `/api/settings/ai-tasks/${encodeURIComponent(taskKey)}/error`,
      { method: "DELETE" },
    ),

  saveAIProvider: (
    input: {
      name: string;
      baseUrl: string;
      apiMode: AIProviderConfig["apiMode"];
      model: string;
      token?: string;
    },
    id?: string,
  ) =>
    apiFetch<{ provider: AIProviderConfig }>(
      id
        ? `/api/settings/ai-providers/${encodeURIComponent(id)}`
        : "/api/settings/ai-providers",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(input),
      },
    ),

  deleteAIProvider: (id: string) =>
    apiFetch<void>(
      `/api/settings/ai-providers/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  aiPrompts: () =>
    apiFetch<{ features: AIPromptFeature[] }>("/api/settings/ai-prompts"),
  classificationTaxonomies: () =>
    apiFetch<{ taxonomies: ClassificationTaxonomyState[] }>(
      "/api/settings/classification-taxonomies",
    ),
  refreshClassificationTaxonomy: (repoId: "vllm" | "vllm-ascend") =>
    apiFetch<{ taxonomy: ClassificationTaxonomyState | null; job?: LocalAnalysisJob | null }>(
      `/api/settings/classification-taxonomies/${encodeURIComponent(repoId)}/refresh`,
      { method: "POST" },
    ),

  saveAIPrompt: (
    input: {
      featureKey: PromptFeatureKey;
      name: string;
      content: string;
      makeActive?: boolean;
    },
    id?: string,
  ) =>
    apiFetch<{ template: unknown }>(
      id
        ? `/api/settings/ai-prompts/${encodeURIComponent(id)}`
        : "/api/settings/ai-prompts",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(input),
      },
    ),

  deleteAIPrompt: (id: string) =>
    apiFetch<void>(`/api/settings/ai-prompts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  refreshSettings: () =>
    apiFetch<{ tasks: RefreshTaskState[] }>(
      "/api/settings/community-refresh",
    ),

  updateRefreshSettings: (
    repo: string,
    taskType: RefreshTaskType,
    input: Partial<{
      autoEnabled: boolean;
      intervalMinutes: number | null;
      activeRangeHours: number;
      refreshRule: RefreshRule;
      maxItems: number;
      includeCiChanges: boolean;
      includeCommentChanges: boolean;
      stateFilter: "all" | "open" | "draft" | "merged" | "closed";
      domainFilter: string;
    }>,
  ) =>
    apiFetch<{ task: RefreshTaskState }>(
      `/api/settings/community-refresh/${encodeURIComponent(repo)}/${taskType}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
};
