import { refreshCommunitySummaries } from "../summary-refresh";
import type { RefreshTaskHandler } from "./types";

export const summaryRefreshHandler: RefreshTaskHandler<"summary"> = {
  taskType: "summary",
  async execute({ env, input, config, priority }) {
    const result = await refreshCommunitySummaries(env, {
      userId: input.userId,
      repoId: input.repoId,
      activeRangeHours: Number(config.active_range_hours),
      maxItems: Number(config.max_items),
      itemId: input.itemId,
      priority,
      stateFilter: config.state_filter || "all",
      domainFilter: config.domain_filter || "all",
    });
    return { result, committedWatermarkAt: null };
  },
};
