import { decryptCredential, encryptCredential } from "../credentials";
import type { WorkerEnv } from "../db";
import { githubFetch } from "../integrations/github/client";
import { HttpError } from "../http";
import {
  deleteGithubCredential,
  findGithubCredential,
  saveGithubCredential,
  updateGithubCredentialRateLimits,
  updateGithubCredentialVerification,
} from "../repositories/github-credentials";

type GithubRateResource = {
  remaining?: number;
  limit?: number;
  reset?: number;
};

function normalizedRateResource(resource: GithubRateResource | undefined) {
  return {
    remaining: Number.isFinite(Number(resource?.remaining)) ? Number(resource?.remaining) : null,
    limit: Number.isFinite(Number(resource?.limit)) ? Number(resource?.limit) : null,
    resetAt: resource?.reset
      ? new Date(Number(resource.reset) * 1_000).toISOString()
      : null,
  };
}

async function fetchGithubRateLimits(env: WorkerEnv) {
  const rate = await githubFetch<{
    resources?: { core?: GithubRateResource; graphql?: GithubRateResource };
    rate?: GithubRateResource;
  }>(env, "/rate_limit");
  return {
    rest: normalizedRateResource(rate.resources?.core ?? rate.rate),
    graphql: normalizedRateResource(rate.resources?.graphql),
    checkedAt: new Date().toISOString(),
  };
}

function publicGithubSettings(env: WorkerEnv, row: Record<string, any> | null) {
  const source = row?.encrypted_token
    ? "account"
    : env.GITHUB_TOKEN
      ? "environment"
      : "none";
  return {
    configured: source !== "none",
    source,
    tokenHint: row?.token_hint || "",
    verifiedLogin: row?.verified_login || "",
    rateLimitRemaining: row?.rate_limit_remaining ?? null,
    rateLimitLimit: row?.rate_limit_limit ?? null,
    rateLimitResetAt: row?.rate_limit_reset_at ?? null,
    graphqlRateLimitRemaining: row?.graphql_rate_limit_remaining ?? null,
    graphqlRateLimitLimit: row?.graphql_rate_limit_limit ?? null,
    graphqlRateLimitResetAt: row?.graphql_rate_limit_reset_at ?? null,
    rateLimitCheckedAt: row?.rate_limit_checked_at ?? null,
    lastVerifiedAt: row?.last_verified_at ?? null,
    lastError: row?.last_error ?? null,
  };
}

export async function getGithubSettings(env: WorkerEnv, userId: string) {
  return publicGithubSettings(env, await findGithubCredential(env, userId));
}

export async function saveGithubToken(
  env: WorkerEnv,
  userId: string,
  value: unknown,
) {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 20 || token.length > 500 || /\s/.test(token)) {
    throw new HttpError(400, "请输入有效的 GitHub Token");
  }
  await saveGithubCredential(env, {
    userId,
    encryptedToken: await encryptCredential(env, token),
    tokenHint: token.slice(-4),
  });
  return getGithubSettings(env, userId);
}

export async function getUserGithubToken(env: WorkerEnv, userId: string) {
  const row = await findGithubCredential(env, userId);
  if (!row?.encrypted_token) return env.GITHUB_TOKEN || "";
  return decryptCredential(env, row.encrypted_token);
}

export async function withUserGithubToken(env: WorkerEnv, userId: string) {
  const token = await getUserGithubToken(env, userId);
  return token ? { ...env, GITHUB_TOKEN: token } : env;
}

export async function verifyGithubToken(env: WorkerEnv, userId: string) {
  const row = await findGithubCredential(env, userId);
  const token = row?.encrypted_token
    ? await decryptCredential(env, row.encrypted_token)
    : env.GITHUB_TOKEN || "";
  if (!token) throw new HttpError(400, "请先保存 GitHub Token");
  const githubEnv = { ...env, GITHUB_TOKEN: token };
  try {
    const [account, rates] = await Promise.all([
      githubFetch<{ login?: string }>(githubEnv, "/user"),
      fetchGithubRateLimits(githubEnv),
    ]);
    if (row?.encrypted_token) {
      await updateGithubCredentialVerification(env, {
        userId,
        login: account.login || "",
        remaining: rates.rest.remaining,
        limit: rates.rest.limit,
        resetAt: rates.rest.resetAt,
        graphqlRemaining: rates.graphql.remaining,
        graphqlLimit: rates.graphql.limit,
        graphqlResetAt: rates.graphql.resetAt,
        rateLimitCheckedAt: rates.checkedAt,
      });
    }
    return {
      ...(await getGithubSettings(env, userId)),
      verifiedLogin: account.login || "",
      rateLimitRemaining: rates.rest.remaining,
      rateLimitLimit: rates.rest.limit,
      rateLimitResetAt: rates.rest.resetAt,
      graphqlRateLimitRemaining: rates.graphql.remaining,
      graphqlRateLimitLimit: rates.graphql.limit,
      graphqlRateLimitResetAt: rates.graphql.resetAt,
      rateLimitCheckedAt: rates.checkedAt,
      lastVerifiedAt: new Date().toISOString(),
      lastError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Token 验证失败";
    if (row?.encrypted_token) {
      await updateGithubCredentialVerification(env, { userId, error: message });
    }
    throw error;
  }
}

export async function refreshGithubRateLimits(env: WorkerEnv, userId: string) {
  const row = await findGithubCredential(env, userId);
  const githubEnv = await withUserGithubToken(env, userId);
  const rates = await fetchGithubRateLimits(githubEnv);
  if (row?.encrypted_token) {
    await updateGithubCredentialRateLimits(env, {
      userId,
      remaining: rates.rest.remaining,
      limit: rates.rest.limit,
      resetAt: rates.rest.resetAt,
      graphqlRemaining: rates.graphql.remaining,
      graphqlLimit: rates.graphql.limit,
      graphqlResetAt: rates.graphql.resetAt,
      checkedAt: rates.checkedAt,
    });
  }
  return {
    ...(await getGithubSettings(env, userId)),
    rateLimitRemaining: rates.rest.remaining,
    rateLimitLimit: rates.rest.limit,
    rateLimitResetAt: rates.rest.resetAt,
    graphqlRateLimitRemaining: rates.graphql.remaining,
    graphqlRateLimitLimit: rates.graphql.limit,
    graphqlRateLimitResetAt: rates.graphql.resetAt,
    rateLimitCheckedAt: rates.checkedAt,
  };
}

export async function removeGithubToken(env: WorkerEnv, userId: string) {
  await deleteGithubCredential(env, userId);
  return getGithubSettings(env, userId);
}
