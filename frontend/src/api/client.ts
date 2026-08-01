import { authApi } from "./auth";
import { chatApi } from "./chat";
import { communityApi } from "./community";
import { contentApi } from "./content";
import { settingsApi } from "./settings";

export { ApiError } from "./core";

export const api = {
  ...authApi,
  ...communityApi,
  ...contentApi,
  ...chatApi,
  ...settingsApi,
};
