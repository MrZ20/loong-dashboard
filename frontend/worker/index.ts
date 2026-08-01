import type { WorkerEnv } from "./db";
import { handleError, HttpError } from "./http";
import { handleApi } from "./routes/api";
import { isKnownApiPath } from "./routes/manifest";

async function fetchHandler(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    if (!isKnownApiPath(url.pathname)) {
      return handleError(new HttpError(404, "API 接口不存在"));
    }
    try {
      return await handleApi(request, env);
    } catch (error) {
      return handleError(error);
    }
  }

  const response = await env.ASSETS.fetch(request);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (
    response.status !== 404 ||
    !acceptsHtml ||
    !["GET", "HEAD"].includes(request.method)
  ) {
    return response;
  }

  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";
  return env.ASSETS.fetch(new Request(indexUrl, request));
}

export default {
  fetch: fetchHandler,
};
