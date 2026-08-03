export type ReviewCheck = {
  name: string;
  status: "success" | "failure" | "pending" | "neutral";
  url?: string;
};

export type ReviewSignal = {
  action: "ready" | "attention" | "waiting" | "blocked" | "complete" | "unknown";
  label: string;
  summary: string;
  score: number;
  completeness: "full" | "partial";
  ciStatus: "success" | "failure" | "pending" | "unknown";
  checks: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    details: ReviewCheck[];
  };
  mergeability: "mergeable" | "conflicting" | "unknown";
  mergeState: string;
  reviewDecision: "approved" | "changes_requested" | "review_required" | "unknown";
  behindBy: number | null;
  changedFiles: number;
  additions: number;
  deletions: number;
  reasons: string[];
  source: "github-graphql" | "github-rest" | "metadata";
  updatedAt: string;
};

export type PullReviewFacts = {
  state?: string;
  draft?: boolean;
  mergeability?: ReviewSignal["mergeability"];
  mergeState?: string;
  reviewDecision?: ReviewSignal["reviewDecision"];
  behindBy?: number | null;
  changedFiles?: number;
  additions?: number;
  deletions?: number;
  comments?: number;
  checks?: ReviewCheck[];
  ciStatus?: ReviewSignal["ciStatus"];
  source?: ReviewSignal["source"];
};

export function normalizeCiStatus(
  checks: ReviewCheck[],
  fallback?: ReviewSignal["ciStatus"],
): ReviewSignal["ciStatus"] {
  if (checks.some((check) => check.status === "failure")) return "failure";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.length && checks.every((check) => ["success", "neutral"].includes(check.status))) {
    return "success";
  }
  return fallback ?? "unknown";
}

export function buildReviewSignal(
  facts: PullReviewFacts,
  domain = "Other",
): ReviewSignal {
  const checks = facts.checks ?? [];
  const ciStatus = normalizeCiStatus(checks, facts.ciStatus);
  const mergeability = facts.mergeability ?? "unknown";
  const reviewDecision = facts.reviewDecision ?? "unknown";
  const changedFiles = Number(facts.changedFiles ?? 0);
  const additions = Number(facts.additions ?? 0);
  const deletions = Number(facts.deletions ?? 0);
  const behindBy = facts.behindBy == null ? null : Number(facts.behindBy);
  const reasons: string[] = [];
  let action: ReviewSignal["action"] = "unknown";
  let label = "信号待补全";
  let summary = "可以阅读代码，但 CI、冲突或 Review 状态尚未完全采集。";

  if (facts.state === "merged" || facts.state === "closed") {
    action = "complete";
    label = facts.state === "merged" ? "已合并" : "已关闭";
    summary = "这个 PR 已结束，可按需复盘，不再作为当前 Review 候选。";
  } else if (facts.draft) {
    action = "waiting";
    label = "Draft，暂缓";
    summary = "作者仍在准备改动，建议等待 Ready for review。";
    reasons.push("当前仍是 Draft");
  } else if (mergeability === "conflicting") {
    action = "blocked";
    label = "先解决冲突";
    summary = "当前与目标分支存在冲突，作者更新分支后再完整 Review 更高效。";
    reasons.push("GitHub 判定存在合并冲突");
  } else if (ciStatus === "failure") {
    action = "attention";
    label = "CI 失败，优先检查";
    summary = "存在失败检查，适合先定位失败是否与本次改动相关。";
    reasons.push(`${checks.filter((check) => check.status === "failure").length || 1} 项检查失败`);
  } else if (reviewDecision === "changes_requested") {
    action = "attention";
    label = "有修改请求";
    summary = "已有 Reviewer 提出修改要求，适合关注新提交是否解决问题。";
    reasons.push("存在未解决的 Changes requested");
  } else if (ciStatus === "pending") {
    action = "waiting";
    label = "可先看代码，等待 CI";
    summary = "代码可以开始阅读，但最终结论应等待检查完成。";
    reasons.push(`${checks.filter((check) => check.status === "pending").length || 1} 项检查运行中`);
  } else if (ciStatus === "success" && mergeability === "mergeable") {
    action = "ready";
    label = reviewDecision === "approved" ? "已批准，可复核" : "现在适合 Review";
    summary = "检查通过且没有合并冲突，具备完整 Review 条件。";
    reasons.push("CI/check 已通过", "GitHub 判定可以合并");
  } else {
    action = "ready";
    label = "可开始 Review";
    summary = "PR 已开放且不是 Draft；缺失的运行信号会在详情中按需补齐。";
  }

  if (behindBy !== null && behindBy > 0) reasons.push(`分支落后目标分支 ${behindBy} 个提交`);
  if (changedFiles > 0) reasons.push(`修改 ${changedFiles} 个文件，+${additions} / -${deletions}`);
  if (domain !== "Other") reasons.push(`主要涉及 ${domain}`);

  let score = 45;
  if (!facts.draft && facts.state === "open") score += 12;
  if (ciStatus === "failure") score += 14;
  if (ciStatus === "success") score += 8;
  if (reviewDecision === "changes_requested") score += 12;
  if (reviewDecision === "approved") score -= 8;
  if (mergeability === "conflicting") score -= 24;
  if (behindBy !== null && behindBy >= 20) score -= 10;
  if (changedFiles >= 2 && changedFiles <= 40) score += 6;
  if (changedFiles > 100) score -= 8;
  if (domain !== "Other" && !["Documentation", "Tests", "CI / Infra"].includes(domain)) score += 8;
  if (facts.state === "merged" || facts.state === "closed") score = 0;

  return {
    action,
    label,
    summary,
    score: Math.max(0, Math.min(100, score)),
    completeness:
      facts.source !== "metadata" && (ciStatus !== "unknown" || mergeability !== "unknown")
        ? "full"
        : "partial",
    ciStatus,
    checks: {
      total: checks.length,
      passed: checks.filter((check) => ["success", "neutral"].includes(check.status)).length,
      failed: checks.filter((check) => check.status === "failure").length,
      pending: checks.filter((check) => check.status === "pending").length,
      details: checks.slice(0, 20),
    },
    mergeability,
    mergeState: facts.mergeState ?? "",
    reviewDecision,
    behindBy,
    changedFiles,
    additions,
    deletions,
    reasons: [...new Set(reasons)].slice(0, 8),
    source: facts.source ?? "metadata",
    updatedAt: new Date().toISOString(),
  };
}
