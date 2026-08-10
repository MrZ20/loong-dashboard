import type { RefreshTaskType } from "../../domain/refresh-policy";
import { classificationRefreshHandler } from "./classification";
import { factsRefreshHandler } from "./facts";
import { summaryRefreshHandler } from "./summary";
import type {
  ExecutableRefreshTaskType,
  RefreshTaskDefinition,
  RefreshTaskHandler,
} from "./types";

const definitions = {
  facts: {
    taskType: "facts",
    allowedRules: ["updated_since_success"],
    supportsAutomatic: true,
    supportsInterval: true,
    supportsSummaryChangeFlags: false,
    supportsFilters: false,
    handler: factsRefreshHandler,
  },
  summary: {
    taskType: "summary",
    allowedRules: ["code_only", "code_or_body", "any_update", "manual"],
    supportsAutomatic: true,
    supportsInterval: true,
    supportsSummaryChangeFlags: true,
    supportsFilters: true,
    handler: summaryRefreshHandler,
  },
  classification: {
    taskType: "classification",
    allowedRules: ["first_only", "code_only", "any_update", "manual"],
    supportsAutomatic: true,
    supportsInterval: false,
    supportsSummaryChangeFlags: false,
    supportsFilters: false,
    handler: classificationRefreshHandler,
  },
  deep_analysis: {
    taskType: "deep_analysis",
    allowedRules: ["manual"],
    supportsAutomatic: false,
    supportsInterval: false,
    supportsSummaryChangeFlags: false,
    supportsFilters: false,
  },
} as const satisfies Record<RefreshTaskType, RefreshTaskDefinition>;

export function getRefreshTaskDefinition<T extends RefreshTaskType>(
  taskType: T,
): (typeof definitions)[T] {
  return definitions[taskType];
}

export function getRefreshTaskHandler<T extends ExecutableRefreshTaskType>(
  taskType: T,
): RefreshTaskHandler<T> {
  const definition = definitions[taskType];
  return definition.handler as RefreshTaskHandler<T>;
}

export const REFRESH_TASK_DEFINITIONS: Readonly<
  Record<RefreshTaskType, RefreshTaskDefinition>
> = definitions;
