import { first, query, run, type WorkerEnv } from "../db";

export function ensureProfileRow(env: WorkerEnv, userId: string) {
  return run(
    env,
    `INSERT INTO user_profiles(user_id, updated_at)
     VALUES(?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, new Date().toISOString()],
  );
}

export function listAccountRows(env: WorkerEnv, userId?: string) {
  return query<Record<string, any>>(
    env,
    `SELECT users.*, user_profiles.role, user_profiles.organization,
      user_profiles.bio
     FROM users
     LEFT JOIN user_profiles ON user_profiles.user_id = users.id
     ${userId ? "WHERE users.id = ?" : ""}
     ORDER BY users.last_seen_at DESC`,
    userId ? [userId] : [],
  );
}

export function findAccountById(env: WorkerEnv, accountId: string) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM users WHERE id = ?",
    [accountId],
  );
}

export function findAccountByEmail(env: WorkerEnv, email: string) {
  return first<Record<string, any>>(
    env,
    "SELECT id FROM users WHERE email = ?",
    [email],
  );
}

export async function updateAccountProfile(
  env: WorkerEnv,
  input: {
    userId: string;
    displayName: string;
    role: string;
    organization: string;
    bio: string;
  },
) {
  const now = new Date().toISOString();
  await run(env, "UPDATE users SET display_name = ? WHERE id = ?", [
    input.displayName,
    input.userId,
  ]);
  await run(
    env,
    `UPDATE user_profiles SET role = ?, organization = ?, bio = ?, updated_at = ?
     WHERE user_id = ?`,
    [input.role, input.organization, input.bio, now, input.userId],
  );
}

export async function insertAccount(
  env: WorkerEnv,
  input: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    organization: string;
  },
) {
  const now = new Date().toISOString();
  await run(
    env,
    `INSERT INTO users(id, email, display_name, created_at, last_seen_at)
     VALUES(?, ?, ?, ?, ?)`,
    [input.id, input.email, input.displayName, now, now],
  );
  await run(
    env,
    `INSERT INTO user_profiles(user_id, role, organization, bio, updated_at)
     VALUES(?, ?, ?, '', ?)`,
    [input.id, input.role, input.organization, now],
  );
}
