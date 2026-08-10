export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  mode: "chatgpt" | "development";
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

export interface GitHubCredentialState {
  configured: boolean;
  source: "account" | "environment" | "none";
  tokenHint: string;
  verifiedLogin: string;
  rateLimitRemaining: number | null;
  rateLimitLimit: number | null;
  rateLimitResetAt: string | null;
  graphqlRateLimitRemaining: number | null;
  graphqlRateLimitLimit: number | null;
  graphqlRateLimitResetAt: string | null;
  rateLimitCheckedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
}
