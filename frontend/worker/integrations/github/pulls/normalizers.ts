import type {
  ReviewCheck,
  ReviewSignal,
} from "../../../domain/review-signals";

export function normalizeCheckStatus(
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

export function mergeChecks(checks: ReviewCheck[]) {
  const byName = new Map<string, ReviewCheck>();
  for (const check of checks) {
    const key = check.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing || existing.status === "pending") byName.set(key, check);
  }
  return [...byName.values()];
}

export function normalizeReviewDecision(
  value: string | null | undefined,
): ReviewSignal["reviewDecision"] {
  const normalized = (value ?? "").toUpperCase();
  if (normalized === "APPROVED") return "approved";
  if (normalized === "CHANGES_REQUESTED") return "changes_requested";
  if (normalized === "REVIEW_REQUIRED") return "review_required";
  return "unknown";
}

export function normalizeMergeability(
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
