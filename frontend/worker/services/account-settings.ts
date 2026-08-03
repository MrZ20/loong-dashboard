import type { WorkerEnv } from "../db";
import {
  ensureProfileRow,
  findAccountByEmail,
  findAccountById,
  insertAccount,
  listAccountRows,
  updateAccountProfile,
} from "../repositories/accounts";

function mapAccount(row: Record<string, any>, currentUserId: string) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role ?? "",
    organization: row.organization ?? "",
    bio: row.bio ?? "",
    current: row.id === currentUserId,
    lastSeenAt: row.last_seen_at,
  };
}

export async function getAccountProfile(env: WorkerEnv, userId: string) {
  await ensureProfileRow(env, userId);
  const row = (await listAccountRows(env, userId))[0];
  return row ? mapAccount(row, userId) : null;
}

export async function getAccounts(
  env: WorkerEnv,
  currentUserId: string,
  includeDevelopmentAccounts: boolean,
) {
  const rows = await listAccountRows(
    env,
    includeDevelopmentAccounts ? undefined : currentUserId,
  );
  return rows.map((row) => mapAccount(row, currentUserId));
}

export async function saveAccountProfile(
  env: WorkerEnv,
  input: Parameters<typeof updateAccountProfile>[1],
) {
  await ensureProfileRow(env, input.userId);
  await updateAccountProfile(env, input);
  return getAccountProfile(env, input.userId);
}

export async function createAccountRecord(
  env: WorkerEnv,
  input: Omit<Parameters<typeof insertAccount>[1], "id">,
) {
  if (await findAccountByEmail(env, input.email)) return null;
  const id = crypto.randomUUID();
  await insertAccount(env, { ...input, id });
  const row = (await listAccountRows(env, id))[0];
  return row ? mapAccount(row, "") : null;
}

export { findAccountById };
