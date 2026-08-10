import type { WorkerEnv } from "../../../db";
import { parseUnifiedDiff } from "../../../domain/diff";
import { HttpError } from "../../../http";
import { githubFetch, githubGraphqlFetch } from "../client";
import type { PullFileStat, PullSyncSnapshot } from "./types";

export async function fetchPullFileStats(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
  seed?: PullSyncSnapshot["diff"],
) {
  if (env.GITHUB_TOKEN) {
    try {
      const entries: PullFileStat[] = [...(seed?.entries ?? [])];
      let cursor: string | null = seed?.endCursor ?? null;
      let files = Number(seed?.files ?? 0);
      let additions = Number(seed?.additions ?? 0);
      let deletions = Number(seed?.deletions ?? 0);
      let hasNextPage = seed ? !seed.complete : true;
      const query = `
        query PullFileStats(
          $owner: String!
          $name: String!
          $number: Int!
          $cursor: String
        ) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              changedFiles
              additions
              deletions
              files(first: 100, after: $cursor) {
                nodes {
                  path
                  additions
                  deletions
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `;

      while (hasNextPage && entries.length < 3_000) {
        const data = await githubGraphqlFetch<{
          repository?: {
            pullRequest?: {
              changedFiles: number;
              additions: number;
              deletions: number;
              files: {
                nodes: Array<PullFileStat | null>;
                pageInfo: {
                  hasNextPage: boolean;
                  endCursor: string | null;
                };
              };
            } | null;
          } | null;
        }>(env, query, { owner, name, number, cursor });
        const pull = data.repository?.pullRequest;
        if (!pull) throw new HttpError(404, "Pull Request 不存在");
        files = Number(pull.changedFiles ?? 0);
        additions = Number(pull.additions ?? 0);
        deletions = Number(pull.deletions ?? 0);
        entries.push(
          ...pull.files.nodes
            .filter((file): file is PullFileStat => Boolean(file))
            .map((file) => ({
              path: file.path,
              additions: Number(file.additions ?? 0),
              deletions: Number(file.deletions ?? 0),
            })),
        );
        hasNextPage = pull.files.pageInfo.hasNextPage;
        cursor = pull.files.pageInfo.endCursor;
      }

      return {
        files,
        additions,
        deletions,
        entries,
        source: "graphql-files",
        complete: !hasNextPage,
        statsOnly: true,
        notice: "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
      };
    } catch {
      // Public repositories still support a REST fallback. Patch fields returned
      // by GitHub are discarded immediately and are never stored or sent here.
    }
  }

  const entries: PullFileStat[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    entries.push(
      ...batch.map((file) => ({
        path: file.filename,
        additions: Number(file.additions ?? 0),
        deletions: Number(file.deletions ?? 0),
      })),
    );
    if (batch.length < 100) break;
  }
  return {
    files: entries.length,
    additions: entries.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.deletions, 0),
    entries,
    source: "files-api-stat",
    complete: entries.length < 3_000,
    statsOnly: true,
    notice: "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
  };
}

export async function fetchPullPatches(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
  eligiblePaths: Set<string>,
) {
  const patches = new Map<string, string>();
  try {
    const rawDiff = await githubFetch<string>(
      env,
      `/repos/${owner}/${name}/pulls/${number}`,
      "application/vnd.github.v3.diff",
    );
    for (const entry of parseUnifiedDiff(rawDiff).entries) {
      if (eligiblePaths.has(entry.path)) patches.set(entry.path, entry.patch);
    }
  } catch {
    // Fall through to the paginated files API when GitHub cannot serve raw diff.
  }

  if (patches.size === eligiblePaths.size) return patches;

  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    for (const file of batch) {
      if (!eligiblePaths.has(file.filename) || patches.has(file.filename)) continue;
      const metadata = [
        `diff --git a/${file.previous_filename ?? file.filename} b/${file.filename}`,
        `status: ${file.status}`,
      ];
      patches.set(
        file.filename,
        typeof file.patch === "string" && file.patch
          ? `${metadata.join("\n")}\n${file.patch}`
          : `${metadata.join("\n")}\n[GitHub 未返回文本 patch：该文件可能是二进制文件，或其 diff 超出 GitHub API 返回限制。]\nsource: ${file.raw_url ?? file.blob_url ?? "unavailable"}`,
      );
    }
    if (patches.size === eligiblePaths.size) break;
    if (batch.length < 100) break;
  }
  return patches;
}
