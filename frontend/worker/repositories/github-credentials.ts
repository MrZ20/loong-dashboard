import { first, run, type WorkerEnv } from "../db";

export function findGithubCredential(env: WorkerEnv, userId: string) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM github_credentials WHERE user_id = ?",
    [userId],
  );
}

export async function saveGithubCredential(
  env: WorkerEnv,
  input: {
    userId: string;
    encryptedToken: string;
    tokenHint: string;
  },
) {
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO github_credentials(
      user_id, encrypted_token, token_hint, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      encrypted_token = excluded.encrypted_token,
      token_hint = excluded.token_hint,
      verified_login = '',
      rate_limit_remaining = NULL,
      rate_limit_limit = NULL,
      rate_limit_reset_at = NULL,
      graphql_rate_limit_remaining = NULL,
      graphql_rate_limit_limit = NULL,
      graphql_rate_limit_reset_at = NULL,
      rate_limit_checked_at = NULL,
      last_verified_at = NULL,
      last_error = NULL,
      updated_at = excluded.updated_at`,
    [input.userId, input.encryptedToken, input.tokenHint, now, now],
  );
  return findGithubCredential(env, input.userId);
}

export async function updateGithubCredentialVerification(
  env: WorkerEnv,
  input: {
    userId: string;
    login?: string;
    remaining?: number | null;
    limit?: number | null;
    resetAt?: string | null;
    graphqlRemaining?: number | null;
    graphqlLimit?: number | null;
    graphqlResetAt?: string | null;
    rateLimitCheckedAt?: string | null;
    error?: string | null;
  },
) {
  const now = new Date().toISOString();
  await run(
    env,
    `UPDATE github_credentials SET verified_login = ?,
      rate_limit_remaining = ?, rate_limit_limit = ?, rate_limit_reset_at = ?,
      graphql_rate_limit_remaining = ?, graphql_rate_limit_limit = ?,
      graphql_rate_limit_reset_at = ?, rate_limit_checked_at = ?,
      last_verified_at = ?, last_error = ?, updated_at = ?
     WHERE user_id = ?`,
    [
      input.login || "",
      input.remaining ?? null,
      input.limit ?? null,
      input.resetAt ?? null,
      input.graphqlRemaining ?? null,
      input.graphqlLimit ?? null,
      input.graphqlResetAt ?? null,
      input.rateLimitCheckedAt ?? (input.error ? null : now),
      input.error ? null : now,
      input.error?.slice(0, 500) ?? null,
      now,
      input.userId,
    ],
  );
  return findGithubCredential(env, input.userId);
}

export function updateGithubCredentialRateLimits(
  env: WorkerEnv,
  input: {
    userId: string;
    remaining: number | null;
    limit: number | null;
    resetAt: string | null;
    graphqlRemaining: number | null;
    graphqlLimit: number | null;
    graphqlResetAt: string | null;
    checkedAt: string;
  },
) {
  return run(
    env,
    `UPDATE github_credentials SET
      rate_limit_remaining = ?, rate_limit_limit = ?, rate_limit_reset_at = ?,
      graphql_rate_limit_remaining = ?, graphql_rate_limit_limit = ?,
      graphql_rate_limit_reset_at = ?, rate_limit_checked_at = ?, updated_at = ?
     WHERE user_id = ?`,
    [
      input.remaining,
      input.limit,
      input.resetAt,
      input.graphqlRemaining,
      input.graphqlLimit,
      input.graphqlResetAt,
      input.checkedAt,
      input.checkedAt,
      input.userId,
    ],
  );
}

export function deleteGithubCredential(env: WorkerEnv, userId: string) {
  return run(env, "DELETE FROM github_credentials WHERE user_id = ?", [userId]);
}
