import { first, query, run, type WorkerEnv } from "../db";

export function listProviderRows(env: WorkerEnv, userId: string) {
  return query<Record<string, any>>(
    env,
    "SELECT * FROM ai_providers WHERE user_id = ? ORDER BY updated_at DESC",
    [userId],
  );
}

export function findProviderRow(
  env: WorkerEnv,
  userId: string,
  providerId: string,
) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM ai_providers WHERE id = ? AND user_id = ?",
    [providerId, userId],
  );
}

export function findProviderByName(
  env: WorkerEnv,
  userId: string,
  name: string,
) {
  return first<{ id: string }>(
    env,
    "SELECT id FROM ai_providers WHERE user_id = ? AND name = ?",
    [userId, name],
  );
}

export async function saveProviderRow(
  env: WorkerEnv,
  input: {
    id: string;
    userId: string;
    name: string;
    baseUrl: string;
    apiMode: string;
    model: string;
    encryptedToken: string;
    tokenHint: string;
    existing: boolean;
  },
) {
  const now = new Date().toISOString();
  if (input.existing) {
    await run(
      env,
      `UPDATE ai_providers SET name = ?, base_url = ?, api_mode = ?, model = ?,
        encrypted_token = ?, token_hint = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        input.name,
        input.baseUrl,
        input.apiMode,
        input.model,
        input.encryptedToken,
        input.tokenHint,
        now,
        input.id,
        input.userId,
      ],
    );
  } else {
    await run(
      env,
      `INSERT INTO ai_providers(
        id, user_id, name, base_url, api_mode, model, encrypted_token,
        token_hint, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.name,
        input.baseUrl,
        input.apiMode,
        input.model,
        input.encryptedToken,
        input.tokenHint,
        now,
        now,
      ],
    );
  }
  return findProviderRow(env, input.userId, input.id);
}

export function deleteProviderRow(
  env: WorkerEnv,
  userId: string,
  providerId: string,
) {
  return run(
    env,
    "DELETE FROM ai_providers WHERE id = ? AND user_id = ?",
    [providerId, userId],
  );
}
