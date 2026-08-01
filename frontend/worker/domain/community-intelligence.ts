type DomainRule = {
  domain: string;
  terms: string[];
  paths: string[];
  fallbackOnly?: boolean;
};

export type DomainAssessment = {
  domain: string;
  source: "files" | "files+text" | "text" | "fallback" | "ai";
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  matchedPaths: string[];
  matchedTerms: string[];
  scores: Array<{ domain: string; score: number }>;
};

export type ReviewCheck = {
  name: string;
  status: "success" | "failure" | "pending" | "neutral";
  url?: string;
};

export type ReviewSignal = {
  action:
    | "ready"
    | "attention"
    | "waiting"
    | "blocked"
    | "complete"
    | "unknown";
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
  reviewDecision:
    | "approved"
    | "changes_requested"
    | "review_required"
    | "unknown";
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

const DOMAIN_RULES: DomainRule[] = [
  {
    domain: "FusedMoE",
    terms: [
      "fused_moe",
      "fusedmoe",
      "moe",
      "expert parallel",
      "all-to-all",
      "grouped matmul",
    ],
    paths: [
      "fused_moe",
      "/moe/",
      "moe_layer",
      "expert_parallel",
      "all2all",
      "all_to_all",
    ],
  },
  {
    domain: "Model Runner",
    terms: [
      "model runner",
      "model_runner",
      "inputbatch",
      "input_batch",
      "aclgraph",
      "graph capture",
    ],
    paths: [
      "model_runner",
      "input_batch",
      "inputbatch",
      "gpu_runner",
      "graph_runner",
      "aclgraph",
      "/worker/",
    ],
  },
  {
    domain: "Scheduler",
    terms: [
      "scheduler",
      "preemption",
      "kv cache manager",
      "block table",
      "spec decode",
    ],
    paths: [
      "/scheduler/",
      "scheduler.py",
      "kv_cache_manager",
      "block_table",
      "spec_decode",
      "/v1/core/",
    ],
  },
  {
    domain: "Attention",
    terms: [
      "attention",
      "mla",
      "prefix cache",
      "flash attention",
      "paged kv",
    ],
    paths: [
      "/attention/",
      "attention.py",
      "flash_attn",
      "flash_attention",
      "/mla/",
      "mla_",
      "prefix_cache",
      "paged_attention",
    ],
  },
  {
    domain: "Distributed",
    terms: [
      "distributed",
      "collective rpc",
      "multiproc",
      "hccl",
      "tensor parallel",
      "multi-node",
    ],
    paths: [
      "/distributed/",
      "parallel_state",
      "collective",
      "multiproc",
      "hccl",
      "tensor_parallel",
      "data_parallel",
    ],
  },
  {
    domain: "Quantization",
    terms: ["quantization", "quantized", "gptq", "awq", "fp8", "int8", "w8a8"],
    paths: ["/quantization/", "quant_utils", "gptq", "awq", "fp8", "w8a8"],
  },
  {
    domain: "Serving / API",
    terms: [
      "api server",
      "openai api",
      "serving",
      "chat completion",
      "request router",
    ],
    paths: [
      "/entrypoints/",
      "/serving/",
      "api_server",
      "openai/",
      "protocol.py",
      "request_router",
    ],
  },
  {
    domain: "Model Support",
    terms: [
      "model support",
      "new model",
      "model implementation",
      "weight loader",
    ],
    paths: [
      "/model_executor/models/",
      "/models/",
      "model_loader",
      "weight_loader",
      "registry.py",
    ],
  },
  {
    domain: "Platform / Hardware",
    terms: ["platform", "hardware", "ascend npu", "device backend", "kernel"],
    paths: [
      "/platforms/",
      "platform.py",
      "/ops/",
      "/kernels/",
      "/csrc/",
      "op_builder",
      "device/",
    ],
  },
  {
    domain: "CI / Infra",
    terms: [
      ".github/workflows",
      "continuous integration",
      "[ci]",
      "ci/",
      "pytest",
      "buildkit",
      "dockerfile",
      "nightly",
    ],
    paths: [
      ".github/workflows/",
      ".buildkite/",
      "/ci/",
      "dockerfile",
      "/docker/",
      "pyproject.toml",
      "cmakelists.txt",
      "/cmake/",
    ],
    fallbackOnly: true,
  },
  {
    domain: "Documentation",
    terms: ["documentation", "docs", "readme"],
    paths: ["/docs/", "docs/", "readme", ".md"],
    fallbackOnly: true,
  },
  {
    domain: "Tests",
    terms: ["test coverage", "regression test", "pytest"],
    paths: ["/tests/", "tests/", "test_", "_test."],
    fallbackOnly: true,
  },
];

function confidenceLabel(
  value: number,
): DomainAssessment["confidenceLabel"] {
  if (value >= 0.78) return "high";
  if (value >= 0.52) return "medium";
  return "low";
}

export function classifyDomain(input: {
  title: string;
  body?: string;
  files?: Array<{ path: string; additions?: number; deletions?: number }>;
}): DomainAssessment {
  const title = input.title.toLowerCase();
  const body = (input.body ?? "").toLowerCase();
  const files = input.files ?? [];
  const scored = DOMAIN_RULES.map((rule) => {
    const matchedPaths = new Set<string>();
    const matchedTerms = new Set<string>();
    let pathScore = 0;
    let textScore = 0;
    const hasTitleTerm = rule.terms.some((term) => title.includes(term));

    for (const file of files) {
      const path = file.path.toLowerCase();
      if (!rule.paths.some((pattern) => path.includes(pattern))) continue;
      matchedPaths.add(file.path);
      const size = Number(file.additions ?? 0) + Number(file.deletions ?? 0);
      pathScore += 8 + (size >= 100 ? 2 : size > 0 ? 1 : 0);
    }
    for (const term of rule.terms) {
      if (title.includes(term)) {
        textScore += 4;
        matchedTerms.add(term);
      } else if (body.includes(term)) {
        textScore += 1;
        matchedTerms.add(term);
      }
    }
    if (
      rule.domain === "CI / Infra" &&
      pathScore === 0 &&
      !title.includes("[ci]") &&
      !title.includes("continuous integration") &&
      !body.includes("continuous integration")
    ) {
      textScore = 0;
      matchedTerms.clear();
    }
    if (rule.domain === "Tests" && pathScore === 0 && !hasTitleTerm) {
      textScore = 0;
      matchedTerms.clear();
    }

    const score = pathScore + textScore;
    return {
      domain: rule.domain,
      score,
      pathScore,
      textScore,
      fallbackOnly: Boolean(rule.fallbackOnly),
      matchedPaths: [...matchedPaths],
      matchedTerms: [...matchedTerms],
    };
  });
  const technicalBest = scored
    .filter((entry) => !entry.fallbackOnly)
    .sort((left, right) => right.score - left.score)[0];
  const fallbackBest = scored
    .filter((entry) => entry.fallbackOnly)
    .sort((left, right) => right.score - left.score)[0];
  const winner =
    technicalBest?.pathScore > 0 || technicalBest?.score >= 4
      ? technicalBest
      : fallbackBest?.score > 0
        ? fallbackBest
        : technicalBest;

  if (!winner || winner.score <= 0) {
    return {
      domain: "Other",
      source: "fallback",
      confidence: 0,
      confidenceLabel: "low",
      matchedPaths: [],
      matchedTerms: [],
      scores: [],
    };
  }

  const ranked = scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  const runnerUp = ranked.find((entry) => entry.domain !== winner.domain);
  const coverage =
    files.length > 0 ? winner.matchedPaths.length / files.length : 0;
  const margin = Math.max(0, winner.score - Number(runnerUp?.score ?? 0));
  const hasFileEvidence = winner.pathScore > 0;
  const confidence = hasFileEvidence
    ? Math.min(0.97, 0.5 + coverage * 0.32 + Math.min(0.15, margin / 40))
    : Math.min(0.58, 0.28 + Math.min(0.3, winner.textScore / 20));

  return {
    domain: winner.domain,
    source: hasFileEvidence
      ? winner.textScore > 0
        ? "files+text"
        : "files"
      : "text",
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel: confidenceLabel(confidence),
    matchedPaths: winner.matchedPaths.slice(0, 6),
    matchedTerms: winner.matchedTerms.slice(0, 6),
    scores: ranked
      .slice(0, 3)
      .map((entry) => ({ domain: entry.domain, score: entry.score })),
  };
}

export function detectDomain(text: string) {
  const [title = "", ...body] = text.split("\n");
  return classifyDomain({ title, body: body.join("\n") }).domain;
}

export function normalizeCiStatus(
  checks: ReviewCheck[],
  fallback?: ReviewSignal["ciStatus"],
): ReviewSignal["ciStatus"] {
  if (checks.some((check) => check.status === "failure")) return "failure";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (
    checks.length &&
    checks.every((check) => ["success", "neutral"].includes(check.status))
  ) {
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
  const behindBy =
    facts.behindBy === null || facts.behindBy === undefined
      ? null
      : Number(facts.behindBy);
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
    reasons.push(
      `${checks.filter((check) => check.status === "failure").length || 1} 项检查失败`,
    );
  } else if (reviewDecision === "changes_requested") {
    action = "attention";
    label = "有修改请求";
    summary = "已有 Reviewer 提出修改要求，适合关注新提交是否解决问题。";
    reasons.push("存在未解决的 Changes requested");
  } else if (ciStatus === "pending") {
    action = "waiting";
    label = "可先看代码，等待 CI";
    summary = "代码可以开始阅读，但最终结论应等待检查完成。";
    reasons.push(
      `${checks.filter((check) => check.status === "pending").length || 1} 项检查运行中`,
    );
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

  if (behindBy !== null && behindBy > 0) {
    reasons.push(`分支落后目标分支 ${behindBy} 个提交`);
  }
  if (changedFiles > 0) {
    reasons.push(`修改 ${changedFiles} 个文件，+${additions} / -${deletions}`);
  }
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
  if (
    domain !== "Other" &&
    !["Documentation", "Tests", "CI / Infra"].includes(domain)
  ) {
    score += 8;
  }
  if (facts.state === "merged" || facts.state === "closed") score = 0;

  return {
    action,
    label,
    summary,
    score: Math.max(0, Math.min(100, score)),
    completeness:
      facts.source !== "metadata" &&
      (ciStatus !== "unknown" || mergeability !== "unknown")
        ? "full"
        : "partial",
    ciStatus,
    checks: {
      total: checks.length,
      passed: checks.filter((check) =>
        ["success", "neutral"].includes(check.status),
      ).length,
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

export function fallbackSummary(title: string, body: string, domain: string) {
  const firstParagraph = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(
      /^#{1,6}\s*(what this pr does.*|why we need it.*|does this pr introduce.*|how was this patch tested.*|motivation.*)\s*$/gim,
      "",
    )
    .split(/\n\s*\n/)
    .map((part) => part.replace(/[#>*_`-]/g, " ").replace(/\s+/g, " ").trim())
    .find(
      (part) =>
        part.length > 30 &&
        !/^(what this pr does.*|why we need it.*|does this pr introduce.*|how was this patch tested.*|motivation.*)$/i.test(
          part,
        ),
    );
  return (
    firstParagraph?.slice(0, 180) ||
    `${domain === "Other" ? "社区" : domain} 相关变化：${title}`.slice(0, 180)
  );
}
