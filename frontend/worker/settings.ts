import type { WorkerEnv } from "./db";
import { HttpError } from "./http";
import { handleAIProviderSettings } from "./routes/settings-ai";
import { handleAITaskSettings } from "./routes/settings-ai-tasks";
import { handleAccountSettings } from "./routes/settings-account";
import { handleClassificationSettings } from "./routes/settings-classification";
import { handleGithubSettings } from "./routes/settings-github";
import { handlePromptSettings } from "./routes/settings-prompts";
import { handleRefreshSettings } from "./routes/settings-refresh";

export async function handleSettings(
  request: Request,
  env: WorkerEnv,
  path: string,
) {
  if (
    path === "/api/settings/ai-management" ||
    path.startsWith("/api/settings/ai-tasks/")
  ) {
    return handleAITaskSettings(request, env, path);
  }
  if (path.startsWith("/api/settings/classification-taxonomies")) {
    return handleClassificationSettings(request, env, path);
  }
  if (path.startsWith("/api/settings/github")) {
    return handleGithubSettings(request, env, path);
  }
  if (path.startsWith("/api/settings/community-refresh")) {
    return handleRefreshSettings(request, env, path);
  }
  if (path.startsWith("/api/settings/ai-prompts")) {
    return handlePromptSettings(request, env, path);
  }
  if (path.startsWith("/api/settings/ai-providers")) {
    return handleAIProviderSettings(request, env, path);
  }
  if (path === "/api/settings/profile" || path.startsWith("/api/settings/accounts")) {
    return handleAccountSettings(request, env, path);
  }
  throw new HttpError(404, "设置接口不存在");
}
