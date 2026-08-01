import {
  normalizeCiStatus,
  type PullReviewFacts,
  type ReviewCheck,
  type ReviewSignal,
} from "../../domain/community-intelligence";
import { parseUnifiedDiff } from "../../domain/diff";
import type { WorkerEnv } from "../../db";
import {
  githubFetch,
  githubGraphqlFetch,
  optionalGithubFetch,
} from "./client";

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

function normalizeCheckStatus(
  state: string | null | undefined,
  conclusion?: string | null,
): ReviewCheck["status"] {
  const normalized = (conclusion || state || "").toUpperCase();
  if (
    [
      "FAILURE",
      "ERROR",
      "ACTION_REQUIRED",
      "TIMED_OUT",
      "CANCELLED",
      "STALE",
    ].includes(normalized)
  ) {
    return "failure";
  }
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(normalized)) {
    return normalized === "SUCCESS" ? "success" : "neutral";
  }
  return "pending";
}

function mergeChecks(checks: ReviewCheck[]) {
  const byName = new Map<string, ReviewCheck>();
  for (const check of checks) {
    const key = check.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing || existing.status === "pending") byName.set(key, check);
  }
  return [...byName.values()];
}

function normalizeReviewDecision(
  value: string | null | undefined,
): ReviewSignal["reviewDecision"] {
  const normalized = (value ?? "").toUpperCase();
  if (normalized === "APPROVED") return "approved";
  if (normalized === "CHANGES_REQUESTED") return "changes_requested";
  if (normalized === "REVIEW_REQUIRED") return "review_required";
  return "unknown";
}

function normalizeMergeability(
  value: string | boolean | null | undefined,
  mergeState = "",
): ReviewSignal["mergeability"] {
  if (value === true || String(value).toUpperCase() === "MERGEABLE") {
    return "mergeable";
  }
  if (
    value === false ||
    String(value).toUpperCase() === "CONFLICTING" ||
    mergeState.toLowerCase() === "dirty"
  ) {
    return "conflicting";
  }
  return "unknown";
}

type PullSyncSnapshot = {
  diff: {
    files: number;
    additions: number;
    deletions: number;
    entries: Array<{ path: string; additions: number; deletions: number }>;
    source: "graphql-files";
    complete: boolean;
    statsOnly: true;
    notice: string;
  };
  reviewFacts: PullReviewFacts;
};

export async function fetchPullSyncSnapshots(
  env: WorkerEnv,
  owner: string,
  name: string,
) {
  const snapshots = new Map<number, PullSyncSnapshot>();
  if (!env.GITHUB_TOKEN) return snapshots;
  const graphql = `
    query PullReviewSignals($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(
          first: 30
          states: [OPEN, CLOSED, MERGED]
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          nodes {
            number
            state
            isDraft
            mergeable
            reviewDecision
            changedFiles
            additions
            deletions
            files(first: 100) {
              nodes {
                path
                additions
                deletions
              }
              pageInfo {
                hasNextPage
              }
            }
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    state
                    contexts(first: 50) {
                      nodes {
                        ... on CheckRun {
                          name
                          status
                          conclusion
                          detailsUrl
                        }
                        ... on StatusContext {
                          context
                          state
                          targetUrl
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await githubGraphqlFetch<{
    repository?: {
      pullRequests: {
        nodes: Array<Record<string, any> | null>;
      };
    } | null;
  }>(env, graphql, { owner, name });

  for (const pull of data.repository?.pullRequests.nodes ?? []) {
    if (!pull?.number) continue;
    const contexts =
      pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
    const checks = mergeChecks(
      contexts
        .filter(Boolean)
        .map((context: Record<string, any>) => ({
          name: context.name || context.context || "未命名检查",
          status: normalizeCheckStatus(context.status || context.state, context.conclusion),
          url: context.detailsUrl || context.targetUrl || undefined,
        })),
    );
    const rollupState =
      pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? "";
    const entries = (pull.files?.nodes ?? [])
      .filter(Boolean)
      .map((file: Record<string, any>) => ({
        path: String(file.path ?? ""),
        additions: Number(file.additions ?? 0),
        deletions: Number(file.deletions ?? 0),
      }));
    snapshots.set(Number(pull.number), {
      diff: {
        files: Number(pull.changedFiles ?? entries.length),
        additions: Number(pull.additions ?? 0),
        deletions: Number(pull.deletions ?? 0),
        entries,
        source: "graphql-files",
        complete: !pull.files?.pageInfo?.hasNextPage,
        statsOnly: true,
        notice: pull.files?.pageInfo?.hasNextPage
          ? "同步阶段已分析前 100 个修改文件；打开详情可补齐全部文件统计。"
          : "同步阶段已获取修改文件统计；具体代码仍按需加载。",
      },
      reviewFacts: {
        state: String(pull.state ?? "").toLowerCase(),
        draft: Boolean(pull.isDraft),
        mergeability: normalizeMergeability(pull.mergeable),
        reviewDecision: normalizeReviewDecision(pull.reviewDecision),
        changedFiles: Number(pull.changedFiles ?? entries.length),
        additions: Number(pull.additions ?? 0),
        deletions: Number(pull.deletions ?? 0),
        checks,
        ciStatus: normalizeCiStatus(
          checks,
          String(rollupState).toUpperCase() === "SUCCESS"
            ? "success"
            : String(rollupState).toUpperCase() === "FAILURE"
              ? "failure"
              : rollupState
                ? "pending"
                : "unknown",
        ),
        source: "github-graphql",
      },
    });
  }
  return snapshots;
}

export async function fetchPullFileStats(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
) {
  if (env.GITHUB_TOKEN) {
    try {
      const entries: Array<{
        path: string;
        additions: number;
        deletions: number;
      }> = [];
      let cursor: string | null = null;
      let files = 0;
      let additions = 0;
      let deletions = 0;
      let hasNextPage = true;
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
                nodes: Array<{
                  path: string;
                  additions: number;
                  deletions: number;
                } | null>;
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
            .filter((file): file is NonNullable<typeof file> => Boolean(file))
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

  const entries: Array<{
    path: string;
    additions: number;
    deletions: number;
  }> = [];
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

export async function fetchPullReviewFacts(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
): Promise<PullReviewFacts> {
  const base = `/repos/${owner}/${name}`;
  const pull = await githubFetch<Record<string, any>>(
    env,
    `${base}/pulls/${number}`,
  );
  const headSha = String(pull.head?.sha ?? "");
  const baseSha = String(pull.base?.sha ?? "");
  const [checkRuns, commitStatus, comparison, reviews] = await Promise.all([
    headSha
      ? optionalGithubFetch<{ check_runs?: Array<Record<string, any>> }>(
          env,
          `${base}/commits/${headSha}/check-runs?per_page=100`,
        )
      : null,
    headSha
      ? optionalGithubFetch<{ statuses?: Array<Record<string, any>> }>(
          env,
          `${base}/commits/${headSha}/status`,
        )
      : null,
    baseSha && headSha
      ? optionalGithubFetch<{ behind_by?: number }>(
          env,
          `${base}/compare/${baseSha}...${headSha}`,
        )
      : null,
    optionalGithubFetch<Array<Record<string, any>>>(
      env,
      `${base}/pulls/${number}/reviews?per_page=100`,
    ),
  ]);

  const checks = mergeChecks([
    ...(checkRuns?.check_runs ?? []).map((check) => ({
      name: String(check.name ?? "未命名检查"),
      status: normalizeCheckStatus(check.status, check.conclusion),
      url: check.details_url || check.html_url || undefined,
    })),
    ...(commitStatus?.statuses ?? []).map((status) => ({
      name: String(status.context ?? "Commit status"),
      status: normalizeCheckStatus(status.state),
      url: status.target_url || undefined,
    })),
  ]);

  const latestReviewByUser = new Map<string, Record<string, any>>();
  for (const review of reviews ?? []) {
    const user = String(review.user?.login ?? review.id ?? "");
    latestReviewByUser.set(user, review);
  }
  const reviewStates = [...latestReviewByUser.values()].map((review) =>
    String(review.state ?? "").toUpperCase(),
  );
  const reviewDecision: ReviewSignal["reviewDecision"] =
    reviewStates.includes("CHANGES_REQUESTED")
      ? "changes_requested"
      : reviewStates.includes("APPROVED")
        ? "approved"
        : Number(pull.requested_reviewers?.length ?? 0) > 0 ||
            Number(pull.requested_teams?.length ?? 0) > 0
          ? "review_required"
          : "unknown";

  return {
    state: pull.merged_at ? "merged" : pull.state,
    draft: Boolean(pull.draft),
    mergeability: normalizeMergeability(
      pull.mergeable,
      String(pull.mergeable_state ?? ""),
    ),
    mergeState: String(pull.mergeable_state ?? ""),
    reviewDecision,
    behindBy:
      comparison?.behind_by === undefined
        ? null
        : Number(comparison.behind_by),
    changedFiles: Number(pull.changed_files ?? 0),
    additions: Number(pull.additions ?? 0),
    deletions: Number(pull.deletions ?? 0),
    comments:
      Number(pull.comments ?? 0) + Number(pull.review_comments ?? 0),
    checks,
    ciStatus: normalizeCiStatus(checks),
    source: "github-rest",
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
      if (eligiblePaths.has(entry.path)) {
        patches.set(entry.path, entry.patch);
      }
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
      if (
        !eligiblePaths.has(file.filename) ||
        patches.has(file.filename)
      ) {
        continue;
      }
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


