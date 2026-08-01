import type {
  AIProviderConfig,
  AuthUser,
  UserAccount,
} from "../types";
import { apiFetch } from "./core";

export const settingsApi = {
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

  saveAIProvider: (
    input: {
      name: string;
      baseUrl: string;
      apiMode: AIProviderConfig["apiMode"];
      model: string;
      token?: string;
      makeActive?: boolean;
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

  activateAIProvider: (id: string) =>
    apiFetch<{ ok: boolean; activeProviderId: string }>(
      `/api/settings/ai-providers/${encodeURIComponent(id)}/activate`,
      { method: "POST" },
    ),

  deleteAIProvider: (id: string) =>
    apiFetch<void>(
      `/api/settings/ai-providers/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};

