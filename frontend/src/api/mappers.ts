import type { CommunityItem } from "../types/community";

function relativeTime(value: string) {
  const timestamp = new Date(value).valueOf();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.round(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)} 小时前`;
  return `${Math.round(seconds / 86_400)} 天前`;
}

export function mapCommunityItem(item: any): CommunityItem {
  const rawDomainAssessment = item.domainAssessment ?? {};
  const domainAssessment = {
    domain: rawDomainAssessment.domain ?? item.domain ?? "Other",
    source: rawDomainAssessment.source ?? "text",
    confidence: Number(rawDomainAssessment.confidence ?? 0),
    confidenceLabel: ["high", "medium", "low"].includes(
      rawDomainAssessment.confidenceLabel,
    )
      ? rawDomainAssessment.confidenceLabel
      : "low",
    matchedPaths: Array.isArray(rawDomainAssessment.matchedPaths)
      ? rawDomainAssessment.matchedPaths
      : [],
    matchedTerms: Array.isArray(rawDomainAssessment.matchedTerms)
      ? rawDomainAssessment.matchedTerms
      : [],
    scores: Array.isArray(rawDomainAssessment.scores)
      ? rawDomainAssessment.scores
      : [],
    taxonomyVersion: rawDomainAssessment.taxonomyVersion,
    matchedCodeownerRules: Array.isArray(rawDomainAssessment.matchedCodeownerRules)
      ? rawDomainAssessment.matchedCodeownerRules
      : [],
  } satisfies NonNullable<CommunityItem["domainAssessment"]>;

  return {
    id: Number(item.number),
    repo: item.repo,
    kind: item.kind,
    state: item.state,
    title: item.title,
    author: item.author,
    time: relativeTime(item.updatedAt),
    updatedAt: item.updatedAt,
    statusText: item.statusText,
    domain: item.domain,
    summary: item.aiSummary,
    summarySource: item.summarySource === "ai" ? "ai" : "excerpt",
    summaryUpdatedAt: item.summaryUpdatedAt ?? null,
    factsRefreshedAt: item.factsRefreshedAt ?? null,
    labels: item.labels ?? [],
    baseSha: item.baseSha ?? null,
    headSha: item.headSha ?? null,
    mergeCommitSha: item.mergeCommitSha ?? null,
    summaryStatus: item.summaryStatus ?? "missing",
    summaryVersion: item.summaryVersion,
    classificationStatus: item.classificationStatus ?? "missing",
    classificationVersion: item.classificationVersion,
    deepAnalysisStatus: item.deepAnalysisStatus ?? "missing",
    deepAnalysisHeadSha: item.deepAnalysisHeadSha ?? null,
    body: item.bodyMd,
    bodyMd: item.bodyMd,
    htmlUrl: item.htmlUrl,
    comments: Number(item.comments ?? 0),
    important: Boolean(item.important),
    lastEventType: item.lastEventType ?? null,
    lastEventAt: item.lastEventAt ?? null,
    domainAssessment,
    reviewSignal: item.reviewSignal ?? null,
    reviewSignalUpdatedAt: item.reviewSignalUpdatedAt ?? null,
    diff: item.diff ?? undefined,
    deepAnalysis: {
      overview: "",
      impact: "",
      risks: [],
      suggestions: [],
    },
  };
}
