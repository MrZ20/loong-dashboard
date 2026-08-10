import type {
  PullReviewFacts,
  ReviewSignal,
} from "../../../domain/review-signals";
import { normalizeCiStatus } from "../../../domain/review-signals";
import type { WorkerEnv } from "../../../db";
import {
  githubFetch,
  optionalGithubFetch,
} from "../client";
import {
  mergeChecks,
  normalizeCheckStatus,
  normalizeMergeability,
} from "./normalizers";

export async function fetchPullBehindBy(
  env: WorkerEnv,
  owner: string,
  name: string,
  baseSha: string,
  headSha: string,
) {
  if (!baseSha || !headSha) return null;
  const comparison = await optionalGithubFetch<{ behind_by?: number }>(
    env,
    `/repos/${owner}/${name}/compare/${baseSha}...${headSha}`,
  );
  return comparison?.behind_by === undefined
    ? null
    : Number(comparison.behind_by);
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
  const [checkRuns, commitStatus, reviews] = await Promise.all([
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
    behindBy: null,
    changedFiles: Number(pull.changed_files ?? 0),
    additions: Number(pull.additions ?? 0),
    deletions: Number(pull.deletions ?? 0),
    comments: Number(pull.comments ?? 0) + Number(pull.review_comments ?? 0),
    checks,
    ciStatus: normalizeCiStatus(checks),
    source: "github-rest",
  };
}
