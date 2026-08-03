import type { WorkerEnv } from "../db";
import { fallbackSummary } from "../domain/community-summary";
import { buildReviewSignal } from "../domain/review-signals";
import type { RefreshRule } from "../domain/refresh-policy";
import { githubFetch } from "../integrations/github/client";
import {
  fetchIncrementalIssues,
  fetchIncrementalPulls,
  fetchPullBehindBy,
  fetchPullFileStats,
  fetchPullReviewFacts,
  fetchPullSyncSnapshots,
  type PullSyncSnapshot,
} from "../integrations/github/pulls";
import { HttpError } from "../http";
import { findRefreshTaskConfig } from "../repositories/refresh-tasks";
import {
  countCommunityKinds,
  findFactItem,
  findFactRepository,
  insertFactEvent,
  markCurrentAnalysisOutdated,
  saveCommunityFact,
  scheduleClassificationIfPending,
  updateRepositoryFactStats,
} from "../repositories/facts";
import { shouldMarkSummaryStale } from "../domain/refresh-policy";
import { withUserGithubToken } from "./github-settings";

function communityItemId(repoId: string, kind: string, number: number) {
  return `${repoId}:${kind}:${number}`;
}

export async function stableRefreshHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizedState(kind: "pr" | "issue", item: Record<string, any>) {
  if (kind === "pr" && item.merged_at) return "merged";
  if (kind === "pr" && item.draft) return "draft";
  return String(item.state || "open").toLowerCase();
}

function statusText(kind: "pr" | "issue", state: string) {
  if (state === "merged") return "Merged";
  if (state === "draft") return "Draft";
  if (state === "closed") return "Closed";
  return kind === "pr" ? "Review required" : "Open";
}

async function recordFactEvent(
  env: WorkerEnv,
  input: {
    repoId: string;
    itemId: string;
    eventType: "opened" | "updated" | "draft" | "ready_for_review" | "merged" | "closed" | "reopened";
    occurredAt: string | null | undefined;
    source: "github" | "facts";
    actor?: string | null;
  },
) {
  if (!input.occurredAt) return;
  await insertFactEvent(env, {
    id: crypto.randomUUID(),
    repoId: input.repoId,
    itemId: input.itemId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    observedAt: new Date().toISOString(),
    source: input.source,
    actor: input.actor ?? null,
  });
}

async function upsertFacts(
  env: WorkerEnv,
  input: {
    repoId: string;
    kind: "pr" | "issue";
    item: Record<string, any>;
    summaryRule: RefreshRule;
    includeCiChanges: boolean;
    includeCommentChanges: boolean;
    classificationRule: RefreshRule;
    diff?: Record<string, any> | null;
    reviewFacts?: Record<string, any> | null;
  },
) {
  const item = input.item;
  const id = communityItemId(input.repoId, input.kind, Number(item.number));
  const existing = await findFactItem(env, id);
  const now = new Date().toISOString();
  const title = String(item.title ?? "");
  const body = String(item.body ?? "");
  const state = normalizedState(input.kind, item);
  const labels = (item.labels ?? []).map((label: Record<string, any> | string) =>
    typeof label === "string" ? label : String(label.name ?? ""),
  ).filter(Boolean);
  const baseSha = input.kind === "pr" ? String(item.base?.sha ?? "") || null : null;
  const headSha = input.kind === "pr" ? String(item.head?.sha ?? "") || null : null;
  const mergeCommitSha = input.kind === "pr"
    ? String(item.merge_commit_sha ?? "") || null
    : null;
  const bodyHash = await stableRefreshHash(body);
  const filesHash = input.kind === "pr"
    ? await stableRefreshHash(JSON.stringify(input.diff?.entries ?? []))
    : "";
  const reviewSignal = input.kind === "pr"
    ? buildReviewSignal(
        {
          state,
          draft: Boolean(item.draft),
          comments: Number(input.reviewFacts?.comments ?? item.comments ?? 0),
          ...input.reviewFacts,
        },
        String(existing?.domain ?? "Other"),
      )
    : null;
  const reviewComparable = (value: Record<string, any> | null) => {
    if (!value) return {};
    const { updatedAt: _updatedAt, ...rest } = value;
    return rest;
  };
  const ciComparable = (value: Record<string, any> | null) => ({
    ciStatus: value?.ciStatus ?? "unknown",
    checks: Array.isArray(value?.checks)
      ? value.checks.map((check: Record<string, any>) => ({
          name: String(check.name ?? ""),
          status: String(check.status ?? "unknown"),
        }))
      : [],
  });
  let existingReviewSignal: Record<string, any> | null = null;
  try {
    existingReviewSignal = existing?.review_signal_json
      ? JSON.parse(existing.review_signal_json)
      : null;
  } catch {
    existingReviewSignal = null;
  }
  const factsHash = await stableRefreshHash(JSON.stringify({
    title,
    bodyHash,
    state,
    labels,
    comments: Number(input.reviewFacts?.comments ?? item.comments ?? 0),
    baseSha,
    headSha,
    mergeCommitSha,
    filesHash,
    reviewSignal: reviewComparable(reviewSignal),
  }));
  const titleChanged = Boolean(existing && existing.title !== title);
  const bodyChanged = Boolean(existing && existing.body_hash !== bodyHash);
  const headChanged = Boolean(existing && existing.head_sha !== headSha);
  const filesChanged = Boolean(existing && existing.files_hash !== filesHash);
  const updatedAtChanged = Boolean(existing && existing.updated_at !== item.updated_at);
  const statusChanged = Boolean(existing && existing.state !== state);
  const ciChanged = Boolean(
    existing &&
    JSON.stringify(ciComparable(existingReviewSignal)) !==
      JSON.stringify(ciComparable(reviewSignal)),
  );
  const commentsChanged = Boolean(
    existing && Number(existing.comments ?? 0) !== Number(input.reviewFacts?.comments ?? item.comments ?? 0),
  );
  const summaryMissing = !existing || !existing.ai_summary || existing.summary_status === "missing";
  const summaryStale = shouldMarkSummaryStale(
    {
      kind: input.kind,
      missing: summaryMissing,
      titleChanged,
      bodyChanged,
      headChanged,
      filesChanged,
      updatedAtChanged,
      statusChanged,
      ciChanged,
      commentsChanged,
    },
    {
      refreshRule: input.summaryRule,
      includeCiChanges: input.includeCiChanges,
      includeCommentChanges: input.includeCommentChanges,
    },
  );
  const classificationStale = Boolean(
    existing &&
    existing.classification_status === "ready" &&
    (input.classificationRule === "any_update"
      ? updatedAtChanged
      : headChanged || bodyChanged || filesChanged),
  );
  const contentHash = await stableRefreshHash(`${title}\n${body}\n${state}`);
  const excerpt = fallbackSummary(title, body, String(existing?.domain ?? "Other"));
  const importantText = `${title}\n${body}`.replace(/\b(?:accuracy\s+)?regression tests?\b/gi, "");
  const important = /regression|breaking change|security|critical|cve|data loss|performance drop|回归|安全|破坏性/i.test(importantText) ? 1 : 0;

  await saveCommunityFact(env, {
    id,
    repoId: input.repoId,
    kind: input.kind,
    number: Number(item.number),
    state,
    title,
    author: item.user?.login ?? "unknown",
    authorAvatar: item.user?.avatar_url ?? null,
    body,
    htmlUrl: item.html_url ?? null,
    comments: Number(input.reviewFacts?.comments ?? item.comments ?? 0),
    labels,
    excerpt,
    statusText: statusText(input.kind, state),
    important,
    updatedAt: item.updated_at ?? now,
    createdAt: item.created_at ?? null,
    mergedAt: item.merged_at ?? null,
    closedAt: item.closed_at ?? null,
    isDraft: Boolean(item.draft),
    contentHash,
    summaryInputHash: input.kind === "pr"
      ? `${headSha ?? ""}:${bodyHash}:${filesHash}`
      : bodyHash,
    fetchedAt: now,
    baseSha,
    headSha,
    mergeCommitSha,
    bodyHash,
    filesHash,
    factsHash,
    bodyChangedAt: bodyChanged || !existing ? now : null,
    codeChangedAt: headChanged || filesChanged || !existing ? now : null,
    anyChangedAt: now,
    diff: input.diff ?? null,
    reviewSignal,
    summaryStale,
    classificationStale,
  });

  if (headChanged) {
    await markCurrentAnalysisOutdated(env, id);
  }

  const occurredAt = String(item.updated_at ?? now);
  if (!existing) {
    await recordFactEvent(env, {
      repoId: input.repoId,
      itemId: id,
      eventType: "opened",
      occurredAt: item.created_at ?? occurredAt,
      source: "github",
      actor: item.user?.login,
    });
  }
  if (existing?.state === "closed" && ["open", "draft"].includes(state)) {
    await recordFactEvent(env, { repoId: input.repoId, itemId: id, eventType: "reopened", occurredAt, source: "facts" });
  }
  if (existing?.state !== "merged" && state === "merged") {
    await recordFactEvent(env, { repoId: input.repoId, itemId: id, eventType: "merged", occurredAt: item.merged_at ?? occurredAt, source: "github" });
  } else if (existing && !["closed", "merged"].includes(existing.state) && state === "closed") {
    await recordFactEvent(env, { repoId: input.repoId, itemId: id, eventType: "closed", occurredAt: item.closed_at ?? occurredAt, source: "github" });
  }
  if (input.kind === "pr" && existing && !existing.is_draft && item.draft) {
    await recordFactEvent(env, { repoId: input.repoId, itemId: id, eventType: "draft", occurredAt, source: "facts" });
  } else if (input.kind === "pr" && existing?.is_draft && !item.draft && state === "open") {
    await recordFactEvent(env, { repoId: input.repoId, itemId: id, eventType: "ready_for_review", occurredAt, source: "facts" });
  }
  if (!existing || updatedAtChanged || existing.facts_hash !== factsHash) {
    await recordFactEvent(env, { repoId: input.repoId, itemId: id, eventType: "updated", occurredAt, source: "facts" });
  }
  return { id, updatedAt: String(item.updated_at ?? now) };
}

async function refreshOneFact(
  env: WorkerEnv,
  repository: Record<string, any>,
  kind: "pr" | "issue",
  item: Record<string, any>,
  summaryConfig: Record<string, any> | null,
  classificationConfig: Record<string, any> | null,
  snapshot?: PullSyncSnapshot | null,
) {
  let diff: Record<string, any> | null = null;
  let reviewFacts: Record<string, any> | null = null;
  if (kind === "pr") {
    if (snapshot) {
      const mergeState = String(snapshot.reviewFacts.mergeState ?? "");
      let behindBy: number | null = mergeState === "behind" ? null : 0;
      if (mergeState === "behind") {
        const existing = await findFactItem(
          env,
          communityItemId(repository.id, kind, Number(item.number)),
        );
        let existingBehindBy: number | null = null;
        try {
          const existingSignal = existing?.review_signal_json
            ? JSON.parse(existing.review_signal_json)
            : null;
          existingBehindBy = existingSignal?.behindBy == null
            ? null
            : Number(existingSignal.behindBy);
        } catch {
          existingBehindBy = null;
        }
        const headSha = String(item.head?.sha ?? "");
        if (existing?.head_sha === headSha && existingBehindBy !== null) {
          behindBy = existingBehindBy;
        } else {
          behindBy = await fetchPullBehindBy(
            env,
            repository.owner,
            repository.name,
            String(item.base?.sha ?? ""),
            headSha,
          );
        }
      }
      reviewFacts = { ...snapshot.reviewFacts, behindBy };
      diff = snapshot.diff.complete
        ? snapshot.diff
        : await fetchPullFileStats(
            env,
            repository.owner,
            repository.name,
            Number(item.number),
          );
    } else {
      [diff, reviewFacts] = await Promise.all([
        fetchPullFileStats(env, repository.owner, repository.name, Number(item.number)),
        fetchPullReviewFacts(env, repository.owner, repository.name, Number(item.number)),
      ]);
    }
  }
  return upsertFacts(env, {
    repoId: repository.id,
    kind,
    item,
    summaryRule: (summaryConfig?.refresh_rule as RefreshRule) ?? "code_or_body",
    includeCiChanges: Boolean(summaryConfig?.include_ci_changes),
    includeCommentChanges: Boolean(summaryConfig?.include_comment_changes),
    classificationRule:
      (classificationConfig?.refresh_rule as RefreshRule) ?? "first_only",
    diff,
    reviewFacts,
  });
}

export async function refreshCommunityFacts(
  env: WorkerEnv,
  input: {
    userId: string;
    repoId: string;
    watermark: string | null;
    activeRangeHours: number;
    maxItems: number;
    itemId?: string | null;
  },
) {
  const githubEnv = await withUserGithubToken(env, input.userId);
  const repository = await findFactRepository(env, input.repoId);
  if (!repository) throw new HttpError(404, "仓库不存在");
  const summaryConfig = await findRefreshTaskConfig(
    env,
    input.userId,
    input.repoId,
    "summary",
  );
  const classificationConfig = await findRefreshTaskConfig(
    env,
    input.userId,
    input.repoId,
    "classification",
  );
  const base = `/repos/${repository.owner}/${repository.name}`;
  let targets: Array<{ kind: "pr" | "issue"; item: Record<string, any> }> = [];
  if (input.itemId) {
    const match = input.itemId.match(/^[^:]+:(pr|issue):(\d+)$/);
    if (!match) throw new HttpError(400, "条目标识不正确");
    const kind = match[1] as "pr" | "issue";
    const number = Number(match[2]);
    const item = await githubFetch<Record<string, any>>(
      githubEnv,
      kind === "pr" ? `${base}/pulls/${number}` : `${base}/issues/${number}`,
    );
    targets = [{ kind, item }];
  } else {
    const initialCutoff = new Date(
      Date.now() - input.activeRangeHours * 3_600_000,
    ).toISOString();
    const window = {
      boundary: input.watermark,
      initialCutoff,
    };
    const [pulls, issues] = await Promise.all([
      fetchIncrementalPulls(githubEnv, base, window),
      fetchIncrementalIssues(githubEnv, base, window),
    ]);
    targets = [
      ...pulls.map((item) => ({ kind: "pr" as const, item })),
      ...issues.map((item) => ({ kind: "issue" as const, item })),
    ].sort((left, right) =>
      String(right.item.updated_at ?? "").localeCompare(String(left.item.updated_at ?? "")),
    );
  }

  const pullSnapshots = new Map<number, PullSyncSnapshot>();
  if (!input.itemId) {
    const pullNumbers = targets
      .filter((target) => target.kind === "pr")
      .map((target) => Number(target.item.number));
    if (pullNumbers.length && !githubEnv.GITHUB_TOKEN) {
      throw new HttpError(
        503,
        "批量社区事实刷新需要 GitHub Token；请先在设置中配置，避免使用匿名 Core 额度逐条请求 PR",
      );
    }
    const batchSize = Math.min(Math.max(input.maxItems, 1), 500);
    for (let offset = 0; offset < pullNumbers.length; offset += batchSize) {
      const batch = await fetchPullSyncSnapshots(
        githubEnv,
        repository.owner,
        repository.name,
        pullNumbers.slice(offset, offset + batchSize),
      );
      for (const [number, snapshot] of batch) {
        pullSnapshots.set(number, snapshot);
      }
    }
  }

  const results: Array<{ id: string; updatedAt: string }> = [];
  for (const target of targets) {
    results.push(
      await refreshOneFact(
        githubEnv,
        repository,
        target.kind,
        target.item,
        summaryConfig,
        classificationConfig,
        target.kind === "pr"
          ? pullSnapshots.get(Number(target.item.number))
          : null,
      ),
    );
  }
  const counts = await countCommunityKinds(env, input.repoId);
  const countByKind = new Map(counts.map((row) => [row.kind, Number(row.count)]));
  const finishedAt = new Date().toISOString();
  await updateRepositoryFactStats(env, {
    repoId: input.repoId,
    pullCount: countByKind.get("pr") ?? 0,
    issueCount: countByKind.get("issue") ?? 0,
    finishedAt,
  });
  await scheduleClassificationIfPending(env, {
    userId: input.userId,
    repoId: input.repoId,
    scheduledAt: finishedAt,
  });
  const watermark = results.reduce<string | null>(
    (latest, result) => !latest || result.updatedAt > latest ? result.updatedAt : latest,
    null,
  );
  return {
    itemCount: results.length,
    pulls: results.filter((result) => result.id.includes(":pr:")).length,
    issues: results.filter((result) => result.id.includes(":issue:")).length,
    watermark,
    finishedAt,
  };
}
