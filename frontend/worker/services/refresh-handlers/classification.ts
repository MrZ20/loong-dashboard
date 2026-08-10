import { refreshCommunityClassifications } from "../classification-refresh";
import { heartbeatRefreshTaskRun } from "../../repositories/refresh-tasks";
import type { RefreshTaskHandler } from "./types";

export const classificationRefreshHandler: RefreshTaskHandler<"classification"> = {
  taskType: "classification",
  async execute({ env, input, config, runId }) {
    const result = await refreshCommunityClassifications(env, {
      userId: input.userId,
      repoId: input.repoId,
      refreshRule: config.refresh_rule,
      maxItems: Number(config.max_items),
      itemId: input.itemId,
      forceManual: input.triggerType === "manual",
      onProgress: (progress) => heartbeatRefreshTaskRun(env, {
        runId,
        ...progress,
      }),
    });
    return { result, committedWatermarkAt: null };
  },
};
