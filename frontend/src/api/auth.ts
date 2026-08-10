import type { AuthUser } from "../types/account";
import { apiFetch } from "./core";

export const authApi = {
  health: () =>
    apiFetch<{
      ok: boolean;
      database: boolean;
      aiConfigured: boolean;
      githubConfigured: boolean;
      timestamp: string;
    }>("/api/health"),

  authProviders: () =>
    apiFetch<{
      mode: "development" | "chatgpt";
      signInPath: string;
      signOutPath: string;
    }>("/api/auth/providers"),

  me: () => apiFetch<{ user: AuthUser }>("/api/auth/me"),

  devLogin: (email: string, displayName: string, password: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({ email, displayName, password }),
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

};
