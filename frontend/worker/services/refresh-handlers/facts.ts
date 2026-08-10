import { heartbeatRefreshTaskRun } from "../../repositories/refresh-tasks";
import { refreshCommunityFacts } from "../facts-refresh";
import type { RefreshTaskHandler } from "./types";

export const factsRefreshHandler: RefreshTaskHandler<"facts"> = {
  taskType: "facts",
  async execute({ env, input, config, runId }) {
    const result = await refreshCommunityFacts(env, {
      userId: input.userId,
      repoId: input.repoId,
      watermark: input.itemId ? null : config.watermark_updated_at,
      activeRangeHours: Number(config.active_range_hours),
      maxItems: Number(config.max_items),
      itemId: input.itemId,
      onProgress: (progress) => heartbeatRefreshTaskRun(env, {
        runId,
        ...progress,
      }),
    });
    return {
      result,
      committedWatermarkAt: input.itemId ? null : result.watermark ?? null,
    };
  },
};
