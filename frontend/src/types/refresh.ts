import type {
  RefreshRule,
  RefreshStateFilter,
  RefreshTaskStatus,
  RefreshTaskType,
} from "../../shared/contracts/refresh";

export type {
  RefreshRule,
  RefreshStateFilter,
  RefreshTaskStatus,
  RefreshTaskType,
} from "../../shared/contracts/refresh";

export interface RefreshTaskState {
  repoId: string;
  taskType: RefreshTaskType;
  autoEnabled: boolean;
  intervalMinutes: number | null;
  activeRangeHours: number;
  refreshRule: RefreshRule;
  maxItems: number;
  includeCiChanges: boolean;
  includeCommentChanges: boolean;
  stateFilter: RefreshStateFilter;
  domainFilter: string;
  status: RefreshTaskStatus;
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  watermarkUpdatedAt: string | null;
  nextScheduledAt: string | null;
  lastError: string | null;
  currentStage: string;
  progressCurrent: number;
  progressTotal: number;
  pendingCount: number;
  stale: boolean;
}
