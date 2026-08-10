import type {
  LocalAnalysisEvent,
  LocalAnalysisJob,
  LocalRunnerSettingsState,
} from "../types/analysis";
import { apiFetch } from "./core";

export const localAnalysisApi = {
  localAnalysisSettings: () =>
    apiFetch<LocalRunnerSettingsState>("/api/local-analysis/settings"),

  updateLocalAnalysisSettings: (settings: LocalRunnerSettingsState["settings"]) =>
    apiFetch<LocalRunnerSettingsState>("/api/local-analysis/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  localAnalysisJobs: () =>
    apiFetch<{ jobs: LocalAnalysisJob[] }>("/api/local-analysis/jobs"),

  localAnalysisJob: (jobId: string, after = 0) =>
    apiFetch<{ job: LocalAnalysisJob; events: LocalAnalysisEvent[] }>(
      `/api/local-analysis/jobs/${encodeURIComponent(jobId)}?after=${after}`,
    ),

  cancelLocalAnalysisJob: (jobId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/local-analysis/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" },
    ),

  runLocalAnalysisAction: (action: string, repository = "") =>
    apiFetch<{ job: LocalAnalysisJob }>("/api/local-analysis/actions", {
      method: "POST",
      body: JSON.stringify({ action, repository }),
    }),
};
