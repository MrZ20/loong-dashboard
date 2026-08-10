import type { WorkerEnv } from "../../db";
import type {
  RefreshRule,
  RefreshTaskType,
} from "../../domain/refresh-policy";
import type { RefreshTaskConfigRow } from "../../repositories/refresh-tasks";

export type ExecutableRefreshTaskType = Exclude<
  RefreshTaskType,
  "deep_analysis"
>;

export interface RefreshTaskRequest {
  userId: string;
  repoId: string;
  taskType: ExecutableRefreshTaskType;
  triggerType: "manual" | "scheduled" | "initial";
  itemId?: string | null;
}

export interface RefreshTaskResult extends Record<string, unknown> {
  itemCount: number;
}

export interface RefreshTaskExecution {
  result: RefreshTaskResult;
  committedWatermarkAt: string | null;
}

export interface RefreshTaskExecutionContext {
  env: WorkerEnv;
  input: RefreshTaskRequest;
  config: RefreshTaskConfigRow;
  runId: string;
  priority: "normal" | "high";
}

export interface RefreshTaskHandler<
  TTaskType extends ExecutableRefreshTaskType = ExecutableRefreshTaskType,
> {
  taskType: TTaskType;
  execute(context: RefreshTaskExecutionContext & {
    input: RefreshTaskRequest & { taskType: TTaskType };
  }): Promise<RefreshTaskExecution>;
}

export interface RefreshTaskDefinition {
  taskType: RefreshTaskType;
  allowedRules: readonly RefreshRule[];
  supportsAutomatic: boolean;
  supportsInterval: boolean;
  supportsSummaryChangeFlags: boolean;
  supportsFilters: boolean;
  handler?: RefreshTaskHandler;
}
