const exactApiPaths = new Set([
  "/api/health",
  "/api/auth/providers",
  "/api/auth/me",
  "/api/auth/dev-login",
  "/api/auth/logout",
  "/api/repositories",
  "/api/community",
  "/api/today",
  "/api/impacts",
  "/api/watchlist",
  "/api/analyses",
  "/api/analyses/generate",
  "/api/domains",
  "/api/documents",
  "/api/documents/generate",
  "/api/settings/community-refresh",
  "/api/settings/github",
  "/api/settings/github/test",
  "/api/settings/classification-taxonomies",
  "/api/settings/ai-management",
  "/api/chat/threads",
  "/api/local-analysis/settings",
  "/api/local-analysis/jobs",
  "/api/local-analysis/actions",
  "/api/local-runner/heartbeat",
  "/api/local-runner/claim",
]);

const dynamicApiPaths = [
  /^\/api\/repositories\/[^/]+\/refresh\/[^/]+$/,
  /^\/api\/community\/[^/]+\/(pr|issue)\/\d+(\/(analyze|diff-files))?$/,
  /^\/api\/watchlist\/.+$/,
  /^\/api\/analyses\/[^/]+$/,
  /^\/api\/impacts\/[^/]+$/,
  /^\/api\/domains\/[^/]+\/snapshot$/,
  /^\/api\/documents\/[^/]+$/,
  /^\/api\/settings\/(profile|accounts|ai-providers|ai-prompts|community-refresh)$/,
  /^\/api\/settings\/community-refresh\/[^/]+\/[^/]+$/,
  /^\/api\/settings\/accounts\/[^/]+\/switch$/,
  /^\/api\/settings\/ai-providers\/[^/]+(\/activate)?$/,
  /^\/api\/settings\/ai-prompts\/[^/]+(\/activate)?$/,
  /^\/api\/settings\/ai-tasks\/[^/]+(\/test)?$/,
  /^\/api\/settings\/classification-taxonomies\/[^/]+\/refresh$/,
  /^\/api\/chat\/threads\/[^/]+$/,
  /^\/api\/chat\/threads\/[^/]+\/messages$/,
  /^\/api\/local-analysis\/jobs\/[^/]+(\/cancel)?$/,
  /^\/api\/local-runner\/jobs\/[^/]+(\/(running|events|complete))?$/,
];

export function isKnownApiPath(path: string) {
  return (
    exactApiPaths.has(path) ||
    dynamicApiPaths.some((pattern) => pattern.test(path))
  );
}
