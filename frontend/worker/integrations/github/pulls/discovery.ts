import type { WorkerEnv } from "../../../db";
import {
  includesRefreshBoundary,
  isBeforeRefreshBoundary,
} from "../../../domain/refresh-policy";
import { HttpError } from "../../../http";
import { githubFetch, githubFetchPage } from "../client";
import type { IncrementalWindow } from "./types";

export async function fetchRecentIssues(
  env: WorkerEnv,
  base: string,
  targetCount = 30,
) {
  const issues: any[] = [];
  const perPage = 100;
  const maxPages = 3;
  for (let page = 1; page <= maxPages && issues.length < targetCount; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `${base}/issues?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
    );
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < perPage) break;
  }
  return issues.slice(0, targetCount);
}

async function fetchIncrementalList(
  env: WorkerEnv,
  path: string,
  window: IncrementalWindow,
  accept: (item: Record<string, any>) => boolean,
) {
  const items = new Map<number, Record<string, any>>();
  const lowerBound = window.boundary ?? window.initialCutoff;
  const maxPages = 100;
  let reachedLowerBound = false;
  let nextPath: string | null =
    `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  for (let page = 1; page <= maxPages && nextPath; page += 1) {
    const response = await githubFetchPage<Array<Record<string, any>>>(
      env,
      nextPath,
    );
    const batch = response.data;
    for (const item of batch) {
      const updatedAt = String(item.updated_at ?? "");
      if (
        item.number &&
        accept(item) &&
        includesRefreshBoundary(updatedAt, lowerBound)
      ) {
        const number = Number(item.number);
        const existing = items.get(number);
        if (!existing || updatedAt >= String(existing.updated_at ?? "")) {
          items.set(number, item);
        }
      }
    }
    reachedLowerBound = batch.some((item) =>
      isBeforeRefreshBoundary(String(item.updated_at ?? ""), lowerBound),
    );
    if (reachedLowerBound) break;
    nextPath = response.nextPath;
    if (!nextPath) reachedLowerBound = true;
  }

  if (!reachedLowerBound) {
    throw new HttpError(
      502,
      "GitHub 增量范围过大，本次未完整到达刷新边界，成功水位保持不变",
    );
  }
  return [...items.values()].sort((left, right) =>
    String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")),
  );
}

export function fetchIncrementalPulls(
  env: WorkerEnv,
  base: string,
  window: IncrementalWindow,
) {
  return fetchIncrementalList(
    env,
    `${base}/pulls?state=all&sort=updated&direction=desc`,
    window,
    () => true,
  );
}

export function fetchIncrementalIssues(
  env: WorkerEnv,
  base: string,
  window: IncrementalWindow,
) {
  return fetchIncrementalList(
    env,
    `${base}/issues?state=all&sort=updated&direction=desc`,
    window,
    (item) => !item.pull_request,
  );
}

export async function fetchIncrementalCommunity(
  env: WorkerEnv,
  base: string,
  window: IncrementalWindow,
) {
  const items = await fetchIncrementalList(
    env,
    `${base}/issues?state=all&sort=updated&direction=desc`,
    window,
    () => true,
  );
  return {
    pulls: items.filter((item) => Boolean(item.pull_request)),
    issues: items.filter((item) => !item.pull_request),
  };
}
