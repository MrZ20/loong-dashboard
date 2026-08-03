import type { WorkerEnv } from "../../db";
import { HttpError } from "../../http";

function githubHeaders(
  env: WorkerEnv,
  accept = "application/vnd.github+json",
) {
  const headers: Record<string, string> = {
    accept,
    "user-agent": "LoongBoard/1.0",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

function githubErrorDetail(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // GitHub can return a plain-text proxy or edge error.
  }
  return raw.trim() || "GitHub 未返回错误详情";
}

function safeGithubEndpoint(path: string) {
  try {
    const url = new URL(path, "https://api.github.com");
    return url.pathname;
  } catch {
    return path.split("?", 1)[0].slice(0, 180);
  }
}

export function githubRateLimitDetail(
  response: Response,
  fallback: string,
  authenticated: boolean,
) {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const isRateLimit =
    (response.status === 403 || response.status === 429) &&
    (remaining === "0" || /rate limit/i.test(fallback));
  if (!isRateLimit) return fallback;
  const limit = response.headers.get("x-ratelimit-limit");
  const reset = Number(response.headers.get("x-ratelimit-reset") || 0);
  const resetText = reset > 0
    ? `，预计 ${new Date(reset * 1_000).toISOString()} 重置`
    : "";
  const quota = remaining !== null || limit !== null
    ? `（${remaining ?? "0"}/${limit ?? "未知"}）`
    : "";
  const action = authenticated
    ? "；当前 Token 的额度已耗尽，请等待重置或更换 Token"
    : "；当前为未认证请求，请在设置中配置 GitHub Token";
  return `API 请求额度已用尽${quota}${resetText}${action}`;
}

async function githubResponse(
  env: WorkerEnv,
  path: string,
  accept = "application/vnd.github+json",
) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(env, accept),
  });
  if (!response.ok) {
    const rawDetail = (await response.text()).slice(0, 2_000);
    const detail = githubRateLimitDetail(
      response,
      githubErrorDetail(rawDetail),
      Boolean(env.GITHUB_TOKEN),
    ).slice(0, 500);
    throw new HttpError(
      502,
      `GitHub ${safeGithubEndpoint(path)} 调用失败（${response.status}）：${detail}`,
      rawDetail.slice(0, 500),
    );
  }
  return response;
}

export function githubNextPath(linkHeader: string | null) {
  if (!linkHeader) return null;
  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /;\s*rel="next"\s*$/i.test(part));
  const match = next?.match(/^<([^>]+)>/);
  if (!match) return null;
  const url = new URL(match[1], "https://api.github.com");
  if (url.origin !== "https://api.github.com") {
    throw new HttpError(502, "GitHub 分页链接来源不可信");
  }
  return `${url.pathname}${url.search}`;
}

export async function githubFetch<T>(
  env: WorkerEnv,
  path: string,
  accept?: string,
): Promise<T> {
  const response = await githubResponse(env, path, accept);
  if (accept?.includes("diff")) return (await response.text()) as T;
  return (await response.json()) as T;
}

export async function githubFetchPage<T>(
  env: WorkerEnv,
  path: string,
): Promise<{ data: T; nextPath: string | null }> {
  const response = await githubResponse(env, path);
  return {
    data: (await response.json()) as T,
    nextPath: githubNextPath(response.headers.get("link")),
  };
}

export async function optionalGithubFetch<T>(
  env: WorkerEnv,
  path: string,
): Promise<T | null> {
  try {
    return await githubFetch<T>(env, path);
  } catch {
    return null;
  }
}

export async function githubGraphqlFetch<T>(
  env: WorkerEnv,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!env.GITHUB_TOKEN) {
    throw new HttpError(503, "GitHub GraphQL 需要配置访问令牌");
  }
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(env),
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const raw = await response.text();
  let payload: {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    const detail = githubRateLimitDetail(
      response,
      githubErrorDetail(raw),
      true,
    );
    throw new HttpError(
      502,
      `GitHub GraphQL 返回了无法解析的响应（${response.status}）`,
      detail.slice(0, 500),
    );
  }
  if (!response.ok || payload.errors?.length || !payload.data) {
    const detail =
      payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `GitHub GraphQL 调用失败（${response.status}）`;
    throw new HttpError(502, "GitHub GraphQL 调用失败", detail.slice(0, 500));
  }
  return payload.data;
}
