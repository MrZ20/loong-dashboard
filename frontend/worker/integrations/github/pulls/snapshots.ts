import { normalizeCiStatus } from "../../../domain/review-signals";
import type { WorkerEnv } from "../../../db";
import { HttpError } from "../../../http";
import { githubGraphqlFetch } from "../client";
import {
  mergeChecks,
  normalizeCheckStatus,
  normalizeMergeability,
  normalizeReviewDecision,
} from "./normalizers";
import type { PullSyncSnapshot } from "./types";

export async function fetchPullSyncSnapshots(
  env: WorkerEnv,
  owner: string,
  name: string,
  targetNumbers: readonly number[],
) {
  const snapshots = new Map<number, PullSyncSnapshot>();
  const numbers = [...new Set(
    targetNumbers.filter((number) => Number.isInteger(number) && number > 0),
  )];
  if (!env.GITHUB_TOKEN || !numbers.length) return snapshots;
  const batchSize = 20;
  const batches = Array.from(
    { length: Math.ceil(numbers.length / batchSize) },
    (_, index) => numbers.slice(index * batchSize, (index + 1) * batchSize),
  );

  const loadBatch = async (batch: number[]): Promise<void> => {
    try {
      const variableDeclarations = batch
        .map((_, index) => `$number${index}: Int!`)
        .join("\n");
      const aliases = batch
        .map((_, index) => `
          pull${index}: pullRequest(number: $number${index}) {
            number
            state
            title
            body
            url
            createdAt
            updatedAt
            mergedAt
            closedAt
            isDraft
            author { login avatarUrl }
            labels(first: 30) { nodes { name } }
            baseRefOid
            headRefOid
            mergeCommit { oid }
            mergeable
            mergeStateStatus
            reviewDecision
            changedFiles
            additions
            deletions
            comments { totalCount }
            reviews { totalCount }
            files(first: 100) {
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
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    state
                    contexts(first: 20) {
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
        `)
        .join("\n");
      const graphql = `
      query PullReviewSignals(
        $owner: String!
        $name: String!
        ${variableDeclarations}
      ) {
        repository(owner: $owner, name: $name) {
          ${aliases}
        }
      }
    `;
      const variables = Object.fromEntries(
        batch.map((number, index) => [`number${index}`, number]),
      );
      const data = await githubGraphqlFetch<{
        repository?: Record<string, Record<string, any> | null> | null;
      }>(env, graphql, { owner, name, ...variables });
      for (let index = 0; index < batch.length; index += 1) {
        const pull = data.repository?.[`pull${index}`];
        const number = Number(pull?.number ?? 0);
        if (!number) continue;
        const contexts =
          pull?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
        const checks = mergeChecks(
          contexts
            .filter(Boolean)
            .map((context: Record<string, any>) => ({
              name: context.name || context.context || "未命名检查",
              status: normalizeCheckStatus(
                context.status || context.state,
                context.conclusion,
              ),
              url: context.detailsUrl || context.targetUrl || undefined,
            })),
        );
        const rollupState =
          pull?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? "";
        const entries = (pull?.files?.nodes ?? [])
          .filter(Boolean)
          .map((file: Record<string, any>) => ({
            path: String(file.path ?? ""),
            additions: Number(file.additions ?? 0),
            deletions: Number(file.deletions ?? 0),
          }));
        const filesComplete = !pull?.files?.pageInfo?.hasNextPage;
        snapshots.set(number, {
          item: {
            number,
            state: String(pull?.state ?? "").toLowerCase(),
            title: String(pull?.title ?? ""),
            body: String(pull?.body ?? ""),
            html_url: pull?.url ?? null,
            created_at: pull?.createdAt ?? null,
            updated_at: pull?.updatedAt ?? null,
            merged_at: pull?.mergedAt ?? null,
            closed_at: pull?.closedAt ?? null,
            draft: Boolean(pull?.isDraft),
            user: pull?.author
              ? { login: pull.author.login, avatar_url: pull.author.avatarUrl }
              : null,
            labels: (pull?.labels?.nodes ?? []).filter(Boolean),
            base: { sha: pull?.baseRefOid ?? "" },
            head: { sha: pull?.headRefOid ?? "" },
            merge_commit_sha: pull?.mergeCommit?.oid ?? null,
          },
          diff: {
            files: Number(pull?.changedFiles ?? entries.length),
            additions: Number(pull?.additions ?? 0),
            deletions: Number(pull?.deletions ?? 0),
            entries,
            source: "graphql-files",
            complete: filesComplete,
            endCursor: pull?.files?.pageInfo?.endCursor ?? null,
            statsOnly: true,
            notice: filesComplete
              ? "同步阶段已批量获取修改文件统计；具体代码仍按需加载。"
              : "批量快照包含前 100 个文件；同步任务将继续补齐全部文件统计。",
          },
          reviewFacts: {
            state: String(pull?.state ?? "").toLowerCase(),
            draft: Boolean(pull?.isDraft),
            mergeability: normalizeMergeability(
              pull?.mergeable,
              String(pull?.mergeStateStatus ?? ""),
            ),
            mergeState: String(pull?.mergeStateStatus ?? "").toLowerCase(),
            reviewDecision: normalizeReviewDecision(pull?.reviewDecision),
            changedFiles: Number(pull?.changedFiles ?? entries.length),
            additions: Number(pull?.additions ?? 0),
            deletions: Number(pull?.deletions ?? 0),
            comments:
              Number(pull?.comments?.totalCount ?? 0) +
              Number(pull?.reviews?.totalCount ?? 0),
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
    } catch (error) {
      if (batch.length === 1) {
        const detail = error instanceof HttpError
          ? String(error.details ?? error.message)
          : error instanceof Error
            ? error.message
            : "未知错误";
        throw new HttpError(
          502,
          `GitHub 无法获取 PR #${batch[0]} 的事实快照`,
          detail.slice(0, 500),
        );
      }
      const middle = Math.ceil(batch.length / 2);
      await loadBatch(batch.slice(0, middle));
      await loadBatch(batch.slice(middle));
    }
  };

  for (let offset = 0; offset < batches.length; offset += 3) {
    await Promise.all(batches.slice(offset, offset + 3).map(loadBatch));
  }
  return snapshots;
}
