import type { WorkerEnv } from "../db";
import {
  builtInPromptId,
  getPromptDefinition,
  type PromptFeatureKey,
} from "../domain/prompt-catalog";
import { HttpError } from "../http";
import {
  createPromptTemplateRow,
  deletePromptTemplateRow,
  findPromptTemplateByName,
  findUserPromptTemplate,
  savePromptPreference,
  updatePromptTemplateRow,
} from "../repositories/prompts";
import { replacePromptTemplateBindings } from "../repositories/ai-task-bindings";

export async function createPromptTemplate(
  env: WorkerEnv,
  userId: string,
  input: {
    featureKey: PromptFeatureKey;
    name: string;
    content: string;
    makeActive: boolean;
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
  if (input.makeActive) {
    await savePromptPreference(env, userId, input.featureKey, id, now);
  }
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
  const fallbackTemplateId = builtInPromptId(existing.feature_key);
  await replacePromptTemplateBindings(env, {
    userId,
    promptTemplateId: templateId,
    fallbackTemplateId,
  });
  await deletePromptTemplateRow(env, userId, templateId);
  return { fallbackTemplateId };
}

export async function activatePromptTemplate(
  env: WorkerEnv,
  userId: string,
  templateId: string,
) {
  if (templateId.startsWith("builtin:")) {
    const featureKey = templateId.slice("builtin:".length) as PromptFeatureKey;
    const definition = getPromptDefinition(featureKey);
    if (!definition || builtInPromptId(featureKey) !== templateId) {
      throw new HttpError(404, "系统默认提示词不存在");
    }
    await savePromptPreference(
      env,
      userId,
      featureKey,
      null,
      new Date().toISOString(),
    );
    return { featureKey, activeTemplateId: templateId };
  }
  const template = await findUserPromptTemplate(env, userId, templateId);
  if (!template) throw new HttpError(404, "提示词模板不存在");
  await savePromptPreference(
    env,
    userId,
    template.feature_key,
    template.id,
    new Date().toISOString(),
  );
  return {
    featureKey: template.feature_key,
    activeTemplateId: template.id,
  };
}
