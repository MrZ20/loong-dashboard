import type { WorkerEnv } from "../db";
import type { PromptFeatureKey } from "../domain/prompt-catalog";
import { HttpError } from "../http";
import {
  createPromptTemplateRow,
  deletePromptTemplateRow,
  findPromptTemplateByName,
  findUserPromptTemplate,
  updatePromptTemplateRow,
} from "../repositories/prompts";
import { countPromptTemplateBindings } from "../repositories/ai-task-bindings";

export async function createPromptTemplate(
  env: WorkerEnv,
  userId: string,
  input: {
    featureKey: PromptFeatureKey;
    name: string;
    content: string;
  },
) {
  const duplicate = await findPromptTemplateByName(
    env,
    userId,
    input.featureKey,
    input.name,
  );
  if (duplicate) throw new HttpError(409, "该功能下已有同名提示词");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await createPromptTemplateRow(env, {
    id,
    userId,
    featureKey: input.featureKey,
    name: input.name,
    content: input.content,
    createdAt: now,
  });
  return findUserPromptTemplate(env, userId, id);
}

export async function updatePromptTemplate(
  env: WorkerEnv,
  userId: string,
  templateId: string,
  input: { name: string; content: string },
) {
  const existing = await findUserPromptTemplate(env, userId, templateId);
  if (!existing) throw new HttpError(404, "提示词模板不存在");
  const duplicate = await findPromptTemplateByName(
    env,
    userId,
    existing.feature_key,
    input.name,
  );
  if (duplicate && duplicate.id !== existing.id) {
    throw new HttpError(409, "该功能下已有同名提示词");
  }
  await updatePromptTemplateRow(env, {
    id: templateId,
    userId,
    name: input.name,
    content: input.content,
    updatedAt: new Date().toISOString(),
  });
  return findUserPromptTemplate(env, userId, templateId);
}

export async function removePromptTemplate(
  env: WorkerEnv,
  userId: string,
  templateId: string,
) {
  const existing = await findUserPromptTemplate(env, userId, templateId);
  if (!existing) throw new HttpError(404, "提示词模板不存在");
  if (existing.is_default) throw new HttpError(409, "默认提示词不能删除");
  const usage = await countPromptTemplateBindings(env, userId, templateId);
  if (Number(usage?.count ?? 0) > 0) {
    throw new HttpError(409, `该提示词仍被 ${Number(usage?.count ?? 0)} 个 AI 任务使用，请先切换任务提示词`);
  }
  await deletePromptTemplateRow(env, userId, templateId);
  return { deleted: true };
}
