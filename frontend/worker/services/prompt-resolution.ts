import type { WorkerEnv } from "../db";
import {
  getPromptDefinition,
  PROMPT_CATALOG,
  type PromptFeatureKey,
} from "../domain/prompt-catalog";
import { HttpError } from "../http";
import {
  findDefaultPromptTemplate,
  findUserPromptTemplate,
  listUserPromptTemplates,
  type PromptTemplateRow,
} from "../repositories/prompts";

export interface ResolvedPrompt {
  featureKey: PromptFeatureKey;
  templateId: string;
  name: string;
  instruction: string;
  systemContract: string;
  promptVersion: string;
  revision: number;
  isDefault: boolean;
}

function resolvedStoredPrompt(
  featureKey: PromptFeatureKey,
  row: PromptTemplateRow,
): ResolvedPrompt {
  const definition = getPromptDefinition(featureKey);
  if (row.feature_key !== featureKey) {
    throw new HttpError(409, "所选提示词不属于当前 AI 功能");
  }
  const instruction = row.content.trim();
  if (!instruction) {
    throw new HttpError(409, `${definition.name} 的提示词为空，任务未执行`);
  }
  return {
    featureKey,
    templateId: row.id,
    name: row.name,
    instruction,
    systemContract: definition.systemContract,
    promptVersion: definition.promptVersion,
    revision: Number(row.revision || 1),
    isDefault: Boolean(row.is_default),
  };
}

export async function resolvePrompt(
  env: WorkerEnv,
  userId: string,
  featureKey: PromptFeatureKey,
  selectedTemplateId?: string | null,
): Promise<ResolvedPrompt> {
  if (selectedTemplateId === null || selectedTemplateId === "") {
    throw new HttpError(409, `${getPromptDefinition(featureKey).name} 尚未绑定提示词，任务未执行`);
  }
  const template = selectedTemplateId === undefined
    ? await findDefaultPromptTemplate(env, userId, featureKey)
    : await findUserPromptTemplate(env, userId, selectedTemplateId);
  if (!template) {
    const kind = selectedTemplateId === undefined ? "默认提示词不存在" : "绑定的提示词不存在";
    throw new HttpError(409, `${getPromptDefinition(featureKey).name}${kind}，任务未执行`);
  }
  return resolvedStoredPrompt(featureKey, template);
}

export async function listPromptCenter(
  env: WorkerEnv,
  userId: string,
) {
  const templates = await listUserPromptTemplates(env, userId);

  return PROMPT_CATALOG.map((definition) => {
    const stored = templates.filter(
      (template) => template.feature_key === definition.key,
    );
    return {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      group: definition.group,
      contextSources: definition.contextSources,
      promptVersion: definition.promptVersion,
      templates: stored.map((template) => ({
          id: template.id,
          featureKey: template.feature_key,
          name: template.name,
          content: template.content,
          revision: Number(template.revision || 1),
          isDefault: Boolean(template.is_default),
          createdAt: template.created_at,
          updatedAt: template.updated_at,
        })),
    };
  });
}
