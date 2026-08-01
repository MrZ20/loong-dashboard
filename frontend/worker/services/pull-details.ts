import {
  first,
  mapCommunityItem,
  parseJson,
  run,
  type WorkerEnv,
} from "../db";
import {
  buildReviewSignal,
  classifyDomain,
  type ReviewSignal,
} from "../domain/community-intelligence";
import {
  fetchPullFileStats,
  fetchPullPatches,
  fetchPullReviewFacts,
} from "../integrations/github/pulls";
import { HttpError } from "../http";

export async function ensurePullStats(
  env: WorkerEnv,
  repoId: string,
  number: number,
) {
  const row = await first<Record<string, any>>(
    env,
    `SELECT community_items.*, repositories.owner, repositories.name
     FROM community_items
     JOIN repositories ON repositories.id = community_items.repo_id
     WHERE community_items.repo_id = ? AND community_items.kind = 'pr'
       AND community_items.number = ?`,
    [repoId, number],
  );
  if (!row) throw new HttpError(404, "Pull Request 不存在");
  const storedDiff = parseJson<Record<string, any> | null>(row.diff_json, null);
  const hasUsableStoredDiff =
    storedDiff &&
    (storedDiff.statsOnly !== true ||
      (Array.isArray(storedDiff.entries) && storedDiff.entries.length > 0) ||
      Number(storedDiff.files ?? 0) === 0);
  const diff = hasUsableStoredDiff
    ? storedDiff
    : await fetchPullFileStats(
        env,
        row.owner,
        row.name,
        number,
      );
  const domainAssessment = classifyDomain({
    title: row.title,
    body: row.body_md,
    files: Array.isArray(diff.entries) ? diff.entries : [],
  });
  const currentReviewSignal = parseJson<ReviewSignal | null>(
    row.review_signal_json,
    null,
  );
  let reviewSignal = currentReviewSignal;
  try {
    const reviewFacts = await fetchPullReviewFacts(
      env,
      row.owner,
      row.name,
      number,
    );
    if (
      reviewFacts.reviewDecision === "unknown" &&
      currentReviewSignal?.reviewDecision &&
      currentReviewSignal.reviewDecision !== "unknown"
    ) {
      reviewFacts.reviewDecision = currentReviewSignal.reviewDecision;
    }
    reviewSignal = buildReviewSignal(reviewFacts, domainAssessment.domain);
  } catch {
    reviewSignal =
      currentReviewSignal ??
      buildReviewSignal(
        {
          state: row.state,
          draft: Boolean(row.is_draft),
          changedFiles: Number(diff.files ?? 0),
          additions: Number(diff.additions ?? 0),
          deletions: Number(diff.deletions ?? 0),
          comments: Number(row.comments ?? 0),
          source: "metadata",
        },
        domainAssessment.domain,
      );
  }
  const finalReviewSignal =
    reviewSignal ??
    buildReviewSignal(
      {
        state: row.state,
        draft: Boolean(row.is_draft),
        source: "metadata",
      },
      domainAssessment.domain,
    );
  await run(
    env,
    `UPDATE community_items SET
      diff_json = ?, diff_files_count = ?, additions = ?, deletions = ?,
      domain = ?, domain_source = ?, domain_confidence = ?,
      domain_evidence_json = ?, review_signal_json = ?,
      review_signal_updated_at = ?
     WHERE id = ?`,
    [
      JSON.stringify(diff),
      diff.files,
      diff.additions,
      diff.deletions,
      domainAssessment.domain,
      domainAssessment.source,
      domainAssessment.confidence,
      JSON.stringify(domainAssessment),
      JSON.stringify(finalReviewSignal),
      finalReviewSignal.updatedAt,
      row.id,
    ],
  );
  return mapCommunityItem(
    {
      ...row,
      diff_json: JSON.stringify(diff),
      domain: domainAssessment.domain,
      domain_source: domainAssessment.source,
      domain_confidence: domainAssessment.confidence,
      domain_evidence_json: JSON.stringify(domainAssessment),
      review_signal_json: JSON.stringify(finalReviewSignal),
      review_signal_updated_at: finalReviewSignal.updatedAt,
    },
    "stats",
  );
}

export async function ensurePullPatches(
  env: WorkerEnv,
  repoId: string,
  number: number,
) {
  const row = await first<Record<string, any>>(
    env,
    `SELECT community_items.*, repositories.owner, repositories.name
     FROM community_items
     JOIN repositories ON repositories.id = community_items.repo_id
     WHERE community_items.repo_id = ? AND community_items.kind = 'pr'
       AND community_items.number = ?`,
    [repoId, number],
  );
  if (!row) throw new HttpError(404, "Pull Request 不存在");

  let storedDiff = parseJson<Record<string, any> | null>(row.diff_json, null);
  if (!Array.isArray(storedDiff?.entries)) {
    const item = await ensurePullStats(env, repoId, number);
    storedDiff = item.diff ?? null;
  }
  const stats = Array.isArray(storedDiff?.entries)
    ? storedDiff.entries.map((entry: Record<string, any>) => ({
        path: String(entry.path ?? ""),
        additions: Number(entry.additions ?? 0),
        deletions: Number(entry.deletions ?? 0),
      }))
    : [];
  const eligibleStats = stats.filter(
    (entry) =>
      entry.path &&
      entry.additions + entry.deletions <= 1_000,
  );
  const skippedLarge = stats.length - eligibleStats.length;
  if (eligibleStats.length === 0) {
    return { entries: [], skippedLarge };
  }

  const patches = await fetchPullPatches(
    env,
    row.owner,
    row.name,
    number,
    new Set(eligibleStats.map((entry) => entry.path)),
  );
  return {
    entries: eligibleStats.flatMap((entry) => {
      const patch = patches.get(entry.path);
      return patch ? [{ ...entry, patch }] : [];
    }),
    skippedLarge,
  };
}

