import type { WorkerEnv } from "../db";
import { fallbackSummary } from "../domain/community-summary";
import { buildReviewSignal } from "../domain/review-signals";
import type { RefreshRule } from "../domain/refresh-policy";
import { githubFetch } from "../integrations/github/client";
import {
  fetchIncrementalCommunity,
} from "../integrations/github/pulls/discovery";
import {
  fetchPullFileStats,
} from "../integrations/github/pulls/files";
import {
  fetchPullReviewFacts,
} from "../integrations/github/pulls/reviews";
import {
  fetchPullSyncSnapshots,
} from "../integrations/github/pulls/snapshots";
import type { PullSyncSnapshot } from "../integrations/github/pulls/types";
import { HttpError } from "../http";
import { findRefreshTaskConfig } from "../repositories/refresh-tasks";
import {
  countCommunityKinds,
  findFactItems,
  findFactRepository,
  insertFactEvents,
  markCurrentAnalysesOutdated,
  saveCommunityFacts,
  scheduleClassificationIfPending,
  updateRepositoryFactStats,
  type CommunityFactInput,
  type FactEventInput,
} from "../repositories/facts";
import { shouldMarkSummaryStale } from "../domain/refresh-policy";
import { refreshGithubRateLimits, withUserGithubToken } from "./github-settings";

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

function buildFactEvent(
  input: {
    repoId: string;
    itemId: string;
    eventType: "opened" | "updated" | "draft" | "ready_for_review" | "merged" | "closed" | "reopened";
    occurredAt: string | null | undefined;
    source: "github" | "facts";
    actor?: string | null;
  },
) {
  if (!input.occurredAt) return null;
  return {
    id: crypto.randomUUID(),
    repoId: input.repoId,
    itemId: input.itemId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    observedAt: new Date().toISOString(),
    source: input.source,
    actor: input.actor ?? null,
  } satisfies FactEventInput;
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
    existing?: Record<string, any> | null;
  },
) {
  const item = input.item;
  const id = communityItemId(input.repoId, input.kind, Number(item.number));
  const existing = input.existing ?? null;
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

  const fact: CommunityFactInput = {
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
  };

  const occurredAt = String(item.updated_at ?? now);
  const events: FactEventInput[] = [];
  if (!existing) {
    const opened = buildFactEvent({
      repoId: input.repoId,
      itemId: id,
      eventType: "opened",
      occurredAt: item.created_at ?? occurredAt,
      source: "github",
      actor: item.user?.login,
    });
    if (opened) events.push(opened);
  }
  if (existing?.state === "closed" && ["open", "draft"].includes(state)) {
    const event = buildFactEvent({ repoId: input.repoId, itemId: id, eventType: "reopened", occurredAt, source: "facts" });
    if (event) events.push(event);
  }
  if (existing?.state !== "merged" && state === "merged") {
    const event = buildFactEvent({ repoId: input.repoId, itemId: id, eventType: "merged", occurredAt: item.merged_at ?? occurredAt, source: "github" });
    if (event) events.push(event);
  } else if (existing && !["closed", "merged"].includes(existing.state) && state === "closed") {
    const event = buildFactEvent({ repoId: input.repoId, itemId: id, eventType: "closed", occurredAt: item.closed_at ?? occurredAt, source: "github" });
    if (event) events.push(event);
  }
  if (input.kind === "pr" && existing && !existing.is_draft && item.draft) {
    const event = buildFactEvent({ repoId: input.repoId, itemId: id, eventType: "draft", occurredAt, source: "facts" });
    if (event) events.push(event);
  } else if (input.kind === "pr" && existing?.is_draft && !item.draft && state === "open") {
    const event = buildFactEvent({ repoId: input.repoId, itemId: id, eventType: "ready_for_review", occurredAt, source: "facts" });
    if (event) events.push(event);
  }
  if (existing && (updatedAtChanged || existing.facts_hash !== factsHash)) {
    const event = buildFactEvent({ repoId: input.repoId, itemId: id, eventType: "updated", occurredAt, source: "facts" });
    if (event) events.push(event);
  }
  return {
    result: { id, updatedAt: String(item.updated_at ?? now) },
    fact,
    events,
    markAnalysisOutdated: headChanged,
  };
}

async function refreshOneFact(
  env: WorkerEnv,
  repository: Record<string, any>,
  kind: "pr" | "issue",
  item: Record<string, any>,
  summaryConfig: Record<string, any> | null,
  classificationConfig: Record<string, any> | null,
  existing: Record<string, any> | null,
  snapshot?: PullSyncSnapshot | null,
) {
  if (snapshot) item = { ...item, ...snapshot.item };
  let diff: Record<string, any> | null = null;
  let reviewFacts: Record<string, any> | null = null;
  if (kind === "pr") {
    if (snapshot) {
      reviewFacts = { ...snapshot.reviewFacts, behindBy: null };
      diff = snapshot.diff.complete
        ? snapshot.diff
        : await fetchPullFileStats(
            env,
            repository.owner,
            repository.name,
            Number(item.number),
            snapshot.diff,
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
    existing,
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
    onProgress?: (progress: {
      stage: string;
      current: number;
      total: number;
    }) => Promise<void>;
  },
) {
  await input.onProgress?.({ stage: "discovering", current: 0, total: 0 });
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
    const { pulls, issues } = await fetchIncrementalCommunity(
      githubEnv,
      base,
      window,
    );
    targets = [
      ...pulls.map((item) => ({ kind: "pr" as const, item })),
      ...issues.map((item) => ({ kind: "issue" as const, item })),
    ].sort((left, right) =>
      String(right.item.updated_at ?? "").localeCompare(String(left.item.updated_at ?? "")),
    );
  }

  await input.onProgress?.({
    stage: "discovered",
    current: 0,
    total: targets.length,
  });

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
    const snapshots = await fetchPullSyncSnapshots(
      githubEnv,
      repository.owner,
      repository.name,
      pullNumbers,
    );
    for (const [number, snapshot] of snapshots) {
      pullSnapshots.set(number, snapshot);
    }
    await input.onProgress?.({
      stage: "enriching",
      current: pullSnapshots.size,
      total: targets.length,
    });
    const missing = pullNumbers.filter((number) => !pullSnapshots.has(number));
    if (missing.length) {
      throw new HttpError(
        502,
        `GitHub 未返回 ${missing.length} 个目标 PR 的完整快照，成功水位保持不变`,
      );
    }
    const incomplete = [...pullSnapshots.entries()]
      .filter(([, snapshot]) => !snapshot.diff.complete);
    const fileConcurrency = 4;
    for (let offset = 0; offset < incomplete.length; offset += fileConcurrency) {
      await Promise.all(
        incomplete.slice(offset, offset + fileConcurrency).map(async ([number, snapshot]) => {
          snapshot.diff = await fetchPullFileStats(
            githubEnv,
            repository.owner,
            repository.name,
            number,
            snapshot.diff,
          );
        }),
      );
      await input.onProgress?.({
        stage: "enriching_files",
        current: Math.min(offset + fileConcurrency, incomplete.length),
        total: incomplete.length,
      });
    }
  }

  const existingRows = await findFactItems(
    env,
    targets.map((target) =>
      communityItemId(input.repoId, target.kind, Number(target.item.number)),
    ),
  );
  const existingById = new Map(existingRows.map((row) => [String(row.id), row]));
  const mutations: Awaited<ReturnType<typeof refreshOneFact>>[] = [];
  const mutationBatchSize = 40;
  for (let offset = 0; offset < targets.length; offset += mutationBatchSize) {
    const batch = targets.slice(offset, offset + mutationBatchSize);
    mutations.push(...await Promise.all(batch.map((target) =>
      refreshOneFact(
        githubEnv,
        repository,
        target.kind,
        target.item,
        summaryConfig,
        classificationConfig,
        existingById.get(
          communityItemId(input.repoId, target.kind, Number(target.item.number)),
        ) ?? null,
        target.kind === "pr"
          ? pullSnapshots.get(Number(target.item.number))
          : null,
      ),
    )));
    await input.onProgress?.({
      stage: "preparing_writes",
      current: Math.min(offset + mutationBatchSize, targets.length),
      total: targets.length,
    });
  }
  await input.onProgress?.({ stage: "saving_facts", current: 0, total: targets.length });
  await saveCommunityFacts(env, mutations.map((mutation) => mutation.fact));
  await markCurrentAnalysesOutdated(
    env,
    mutations
      .filter((mutation) => mutation.markAnalysisOutdated)
      .map((mutation) => mutation.result.id),
  );
  await insertFactEvents(
    env,
    mutations.flatMap((mutation) => mutation.events),
  );
  await input.onProgress?.({
    stage: "finalizing",
    current: targets.length,
    total: targets.length,
  });
  const results = mutations.map((mutation) => mutation.result);
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
  await refreshGithubRateLimits(env, input.userId).catch(() => null);
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
