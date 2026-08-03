import { parseJson, type WorkerEnv } from "../db";
import { fetchPullPatches } from "../integrations/github/pulls";
import { HttpError } from "../http";
import { findPullWithRepository } from "../repositories/community";

export async function ensurePullPatches(
  env: WorkerEnv,
  repoId: string,
  number: number,
) {
  const row = await findPullWithRepository(env, repoId, number);
  if (!row) throw new HttpError(404, "Pull Request 不存在");

  let storedDiff = parseJson<Record<string, any> | null>(row.diff_json, null);
  if (!Array.isArray(storedDiff?.entries)) {
    return {
      entries: [],
      skippedLarge: 0,
      skipped: [],
      missingPatchPaths: [],
    };
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
  const skipped = stats
    .filter((entry) => entry.additions + entry.deletions > 1_000)
    .map((entry) => ({
      path: entry.path,
      reason: "changed-lines-over-1000" as const,
      changedLines: entry.additions + entry.deletions,
    }));
  if (eligibleStats.length === 0) {
    return { entries: [], skippedLarge, skipped, missingPatchPaths: [] };
  }

  const patches = await fetchPullPatches(
    env,
    row.owner,
    row.name,
    number,
    new Set(eligibleStats.map((entry) => entry.path)),
  );
  const entries = eligibleStats.flatMap((entry) => {
      const patch = patches.get(entry.path);
      return patch ? [{ ...entry, patch }] : [];
    });
  return {
    entries,
    skippedLarge,
    skipped,
    missingPatchPaths: eligibleStats
      .filter((entry) => !patches.has(entry.path))
      .map((entry) => entry.path),
  };
}
