export type ParsedDiffEntry = {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
};

export function parseUnifiedDiff(rawDiff: string) {
  const entries: ParsedDiffEntry[] = [];
  const chunks = rawDiff.split(/(?=^diff --git )/m).filter(Boolean);

  for (const chunk of chunks) {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = header?.[2] ?? header?.[1] ?? "unknown";
    let additions = 0;
    let deletions = 0;
    for (const line of chunk.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    entries.push({ path, additions, deletions, patch: chunk.trimEnd() });
  }

  return {
    files: entries.length,
    additions: entries.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.deletions, 0),
    entries,
    raw: rawDiff,
    source: "raw-diff" as const,
    complete: true,
  };
}

export function diffToText(diff: unknown) {
  if (!diff || typeof diff !== "object") return "代码修改尚未按需获取";
  const value = diff as {
    files?: number;
    additions?: number;
    deletions?: number;
    statsOnly?: boolean;
    raw?: string;
    entries?: Array<{ path?: string; patch?: string }>;
  };
  if (value.statsOnly) {
    return `${value.files ?? 0} files changed, ${value.additions ?? 0} insertions(+), ${value.deletions ?? 0} deletions(-)`;
  }
  if (typeof value.raw === "string") return value.raw;
  return (value.entries ?? [])
    .map((entry) => `diff -- ${entry.path ?? "unknown"}\n${entry.patch ?? ""}`)
    .join("\n\n");
}
