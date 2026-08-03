import {
  first,
  query,
  run,
  type WorkerEnv,
} from "../db";

export function listThreadRows(env: WorkerEnv, userId: string) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM chat_threads WHERE user_id = ?
     ORDER BY updated_at DESC LIMIT 100`,
    [userId],
  );
}

export function createThreadRow(
  env: WorkerEnv,
  input: {
    id: string;
    userId: string;
    title: string;
    context: unknown;
    mode?: "normal" | "repository";
    repoScope?: string;
    targetRef?: string;
    providerId?: string;
    modelId?: string;
    createdAt: string;
  },
) {
  return run(
    env,
    `INSERT INTO chat_threads(
      id, user_id, title, context_json, mode, repo_scope, target_ref,
      provider_id, model_id, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.userId,
      input.title,
      JSON.stringify(input.context),
      input.mode || "normal",
      input.repoScope || "",
      input.targetRef || "",
      input.providerId || "",
      input.modelId || "",
      input.createdAt,
      input.createdAt,
    ],
  );
}

export function findThreadRow(
  env: WorkerEnv,
  threadId: string,
  userId: string,
) {
  return first<Record<string, any>>(
    env,
    "SELECT * FROM chat_threads WHERE id = ? AND user_id = ?",
    [threadId, userId],
  );
}

export async function deleteThreadRows(
  env: WorkerEnv,
  threadId: string,
  userId: string,
) {
  await run(env, "DELETE FROM chat_messages WHERE thread_id = ?", [threadId]);
  return run(
    env,
    "DELETE FROM chat_threads WHERE id = ? AND user_id = ?",
    [threadId, userId],
  );
}

export function renameThreadRow(
  env: WorkerEnv,
  threadId: string,
  userId: string,
  title: string,
  updatedAt: string,
) {
  return run(
    env,
    "UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    [title, updatedAt, threadId, userId],
  );
}

export function listMessageRows(env: WorkerEnv, threadId: string) {
  return query<Record<string, any>>(
    env,
    `SELECT * FROM chat_messages WHERE thread_id = ?
     ORDER BY created_at ASC`,
    [threadId],
  );
}

export function createMessageRow(
  env: WorkerEnv,
  input: {
    id: string;
    threadId: string;
    role: "user" | "assistant";
    contentMd: string;
    context: unknown;
    createdAt: string;
  },
) {
  return run(
    env,
    `INSERT INTO chat_messages(
      id, thread_id, role, content_md, context_json, created_at
    ) VALUES(?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.threadId,
      input.role,
      input.contentMd,
      JSON.stringify(input.context),
      input.createdAt,
    ],
  );
}

export function listConversationRows(env: WorkerEnv, threadId: string) {
  return query<Record<string, any>>(
    env,
    `SELECT role, content_md FROM chat_messages
     WHERE thread_id = ? ORDER BY created_at ASC LIMIT 50`,
    [threadId],
  );
}

export function touchThreadRow(
  env: WorkerEnv,
  threadId: string,
  titleCandidate: string,
  updatedAt: string,
) {
  return run(
    env,
    `UPDATE chat_threads SET
      updated_at = ?,
      title = CASE WHEN title = '新对话' THEN ? ELSE title END
     WHERE id = ?`,
    [updatedAt, titleCandidate, threadId],
  );
}
