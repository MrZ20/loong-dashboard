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

export async function githubFetch<T>(
  env: WorkerEnv,
  path: string,
  accept?: string,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(env, accept),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new HttpError(502, `GitHub API 调用失败（${response.status}）`, detail);
  }
  if (accept?.includes("diff")) return (await response.text()) as T;
  return (await response.json()) as T;
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
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    const detail =
      payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `GitHub GraphQL 调用失败（${response.status}）`;
    throw new HttpError(502, "GitHub GraphQL 调用失败", detail.slice(0, 500));
  }
  return payload.data;
}
