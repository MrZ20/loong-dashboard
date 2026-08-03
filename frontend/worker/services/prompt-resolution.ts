import type { WorkerEnv } from "../db";
import {
  builtInPromptId,
  getPromptDefinition,
  PROMPT_CATALOG,
  type PromptFeatureKey,
} from "../domain/prompt-catalog";
import {
  findPromptPreference,
  findUserPromptTemplate,
  listPromptPreferences,
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
  builtIn: boolean;
}

function builtInPrompt(featureKey: PromptFeatureKey): ResolvedPrompt {
  const definition = getPromptDefinition(featureKey);
  return {
    featureKey,
    templateId: builtInPromptId(featureKey),
    name: definition.defaultName,
    instruction: definition.defaultInstruction,
    systemContract: definition.systemContract,
    promptVersion: definition.promptVersion,
    revision: definition.revision,
    builtIn: true,
  };
}

function resolvedCustomPrompt(
  featureKey: PromptFeatureKey,
  row: PromptTemplateRow,
): ResolvedPrompt {
  const definition = getPromptDefinition(featureKey);
  return {
    featureKey,
    templateId: row.id,
    name: row.name,
    instruction: row.content,
    systemContract: definition.systemContract,
    promptVersion: definition.promptVersion,
    revision: Number(row.revision || 1),
    builtIn: false,
  };
}

export async function resolvePrompt(
  env: WorkerEnv,
  userId: string,
  featureKey: PromptFeatureKey,
  selectedTemplateId?: string | null,
): Promise<ResolvedPrompt> {
  if (selectedTemplateId === builtInPromptId(featureKey)) {
    return builtInPrompt(featureKey);
  }
  const preference = selectedTemplateId === undefined
    ? await findPromptPreference(env, userId, featureKey)
    : null;
  const activeTemplateId = selectedTemplateId === undefined
    ? preference?.active_template_id
    : selectedTemplateId;
  if (!activeTemplateId) return builtInPrompt(featureKey);
  const custom = await findUserPromptTemplate(
    env,
    userId,
    activeTemplateId,
  );
  if (!custom || custom.feature_key !== featureKey) {
    return builtInPrompt(featureKey);
  }
  return resolvedCustomPrompt(featureKey, custom);
}

export async function listPromptCenter(
  env: WorkerEnv,
  userId: string,
) {
  const [templates, preferences] = await Promise.all([
    listUserPromptTemplates(env, userId),
    listPromptPreferences(env, userId),
  ]);
  const activeByFeature = new Map(
    preferences.map((preference) => [
      preference.feature_key,
      preference.active_template_id,
    ]),
  );

  return PROMPT_CATALOG.map((definition) => {
    const custom = templates.filter(
      (template) => template.feature_key === definition.key,
    );
    const selectedId = activeByFeature.get(definition.key) ?? null;
    const selectedExists = custom.some((template) => template.id === selectedId);
    const activeTemplateId = selectedExists
      ? selectedId!
      : builtInPromptId(definition.key);
    return {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      group: definition.group,
      contextSources: definition.contextSources,
      promptVersion: definition.promptVersion,
      activeTemplateId,
      templates: [
        {
          id: builtInPromptId(definition.key),
          featureKey: definition.key,
          name: definition.defaultName,
          content: definition.defaultInstruction,
          revision: definition.revision,
          builtIn: true,
          active: activeTemplateId === builtInPromptId(definition.key),
          createdAt: null,
          updatedAt: null,
        },
        ...custom.map((template) => ({
          id: template.id,
          featureKey: template.feature_key,
          name: template.name,
          content: template.content,
          revision: Number(template.revision || 1),
          builtIn: false,
          active: activeTemplateId === template.id,
          createdAt: template.created_at,
          updatedAt: template.updated_at,
        })),
      ],
    };
  });
}
