import { authApi } from "./auth";
import { chatApi } from "./chat";
import { communityApi } from "./community";
import { contentApi } from "./content";
import { settingsApi } from "./settings";
import { localAnalysisApi } from "./local-analysis";

export { ApiError } from "./core";

export const api = {
  ...authApi,
  ...communityApi,
  ...contentApi,
  ...chatApi,
  ...settingsApi,
  ...localAnalysisApi,
};
