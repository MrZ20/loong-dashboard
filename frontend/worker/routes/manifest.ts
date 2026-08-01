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
  "/api/chat/threads",
]);

const dynamicApiPaths = [
  /^\/api\/repositories\/[^/]+\/sync$/,
  /^\/api\/community\/[^/]+\/(pr|issue)\/\d+(\/(analyze|diff-files))?$/,
  /^\/api\/watchlist\/.+$/,
  /^\/api\/analyses\/[^/]+$/,
  /^\/api\/impacts\/[^/]+$/,
  /^\/api\/domains\/[^/]+\/snapshot$/,
  /^\/api\/documents\/[^/]+$/,
  /^\/api\/settings\/(profile|accounts|ai-providers)$/,
  /^\/api\/settings\/accounts\/[^/]+\/switch$/,
  /^\/api\/settings\/ai-providers\/[^/]+(\/activate)?$/,
  /^\/api\/chat\/threads\/[^/]+$/,
  /^\/api\/chat\/threads\/[^/]+\/messages$/,
];

export function isKnownApiPath(path: string) {
  return (
    exactApiPaths.has(path) ||
    dynamicApiPaths.some((pattern) => pattern.test(path))
  );
}
