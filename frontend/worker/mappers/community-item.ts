import {
  isJsonObject,
  rowBoolean,
  rowJsonArray,
  rowJsonObject,
  rowJsonStringArray,
  rowNullableText,
  rowNumber,
  rowText,
  type DatabaseRow,
  type JsonObject,
} from "./database-row";

export type CommunityDiffMode = "none" | "stats" | "full";

function confidenceLabel(confidence: number) {
  if (confidence >= 0.78) return "high" as const;
  if (confidence >= 0.52) return "medium" as const;
  return "low" as const;
}

function mapStoredDiff(row: DatabaseRow, diffMode: CommunityDiffMode) {
  if (diffMode === "none") return null;
  const storedDiff = rowJsonObject(row, "diff_json", {});
  if (!Object.keys(storedDiff).length) return null;
  if (diffMode === "full") return storedDiff;

  const entries = Array.isArray(storedDiff.entries)
    ? storedDiff.entries.filter(isJsonObject).map((entry) => ({
        path: typeof entry.path === "string" ? entry.path : "",
        additions: Number.isFinite(Number(entry.additions)) ? Number(entry.additions) : 0,
        deletions: Number.isFinite(Number(entry.deletions)) ? Number(entry.deletions) : 0,
      }))
    : [];
  return {
    ...storedDiff,
    entries,
    raw: undefined,
    statsOnly: true,
    complete: false,
    notice: storedDiff.statsOnly === true && typeof storedDiff.notice === "string"
      ? storedDiff.notice
      : "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
  };
}

function mapDomainAssessment(row: DatabaseRow) {
  const confidence = rowNumber(row, "domain_confidence");
  const fallback: JsonObject = {
    domain: rowText(row, "domain", "Other"),
    source: rowText(row, "domain_source", "text"),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    matchedPaths: [],
    matchedTerms: [],
    scores: [],
  };
  const stored = rowJsonObject(row, "domain_evidence_json", fallback);
  return {
    ...fallback,
    ...stored,
    matchedPaths: Array.isArray(stored.matchedPaths) ? stored.matchedPaths : [],
    matchedTerms: Array.isArray(stored.matchedTerms) ? stored.matchedTerms : [],
    scores: Array.isArray(stored.scores) ? stored.scores : [],
  };
}

export function mapCommunityItem(
  row: DatabaseRow,
  diffMode: CommunityDiffMode = "none",
) {
  const summarySource = rowText(row, "summary_source", "excerpt");
  const reviewSignal = rowText(row, "kind") === "pr"
    ? rowJsonObject(row, "review_signal_json", {})
    : null;
  return {
    id: rowText(row, "id"),
    repo: rowText(row, "repo_id"),
    kind: rowText(row, "kind"),
    number: rowNumber(row, "number"),
    state: rowText(row, "state"),
    title: rowText(row, "title"),
    author: rowText(row, "author"),
    authorAvatar: rowText(row, "author_avatar"),
    bodyMd: rowText(row, "body_md"),
    htmlUrl: rowText(row, "html_url"),
    comments: rowNumber(row, "comments"),
    domain: rowText(row, "domain", "Other"),
    aiSummary: rowText(row, "ai_summary"),
    statusText: rowText(row, "status_text"),
    important: rowBoolean(row, "important"),
    createdAt: rowText(row, "created_at"),
    updatedAt: rowText(row, "updated_at"),
    mergedAt: rowNullableText(row, "merged_at"),
    closedAt: rowNullableText(row, "closed_at"),
    isDraft: rowBoolean(row, "is_draft"),
    summarySource,
    summaryUpdatedAt: rowNullableText(row, "summary_updated_at"),
    lastEventType: rowNullableText(row, "last_event_type"),
    lastEventAt: rowNullableText(row, "last_event_at"),
    fetchedAt: rowText(row, "fetched_at"),
    factsRefreshedAt: rowNullableText(row, "facts_refreshed_at") ?? rowText(row, "fetched_at"),
    labels: rowJsonStringArray(row, "labels_json"),
    baseSha: rowNullableText(row, "base_sha"),
    headSha: rowNullableText(row, "head_sha"),
    mergeCommitSha: rowNullableText(row, "merge_commit_sha"),
    summaryStatus: rowText(row, "summary_status", summarySource === "ai" ? "ready" : "missing"),
    summaryVersion: {
      headSha: rowNullableText(row, "summary_head_sha"),
      bodyHash: rowText(row, "summary_body_hash"),
      filesHash: rowText(row, "summary_files_hash"),
      promptType: rowText(row, "summary_prompt_type"),
      promptVersion: rowText(row, "summary_prompt_version"),
      promptTemplateId: rowNullableText(row, "summary_prompt_template_id"),
      promptRevision: rowNumber(row, "summary_prompt_revision", 1),
      model: rowText(row, "summary_model"),
      provider: rowText(row, "summary_provider"),
      source: summarySource,
      evidenceCompleteness: rowText(row, "summary_evidence_completeness", "insufficient"),
      structured: rowJsonObject(row, "summary_structured_json", {}),
      generatedAt: rowNullableText(row, "summary_generated_at") ?? rowNullableText(row, "summary_updated_at"),
      evidence: rowJsonStringArray(row, "summary_evidence_json"),
      error: rowNullableText(row, "summary_error"),
    },
    classificationStatus: rowText(row, "classification_status", "missing"),
    classificationVersion: {
      headSha: rowNullableText(row, "classification_head_sha"),
      bodyHash: rowText(row, "classification_body_hash"),
      filesHash: rowText(row, "classification_files_hash"),
      generatedAt: rowNullableText(row, "classification_generated_at"),
      locked: rowBoolean(row, "classification_locked"),
      details: rowJsonObject(row, "classification_details_json", {}),
      error: rowNullableText(row, "classification_error"),
    },
    deepAnalysisStatus: rowText(row, "deep_analysis_status", "missing"),
    deepAnalysisHeadSha: rowNullableText(row, "deep_analysis_head_sha"),
    domainAssessment: mapDomainAssessment(row),
    reviewSignal: reviewSignal && Object.keys(reviewSignal).length ? reviewSignal : null,
    reviewSignalUpdatedAt: rowNullableText(row, "review_signal_updated_at"),
    diff: mapStoredDiff(row, diffMode),
  };
}
