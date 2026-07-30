import { summarizeCommunityBatch } from "./ai";
import {
  first,
  mapCommunityItem,
  parseJson,
  query,
  run,
  type WorkerEnv,
} from "./db";
import { HttpError } from "./http";

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

type PullReviewFacts = {
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
    terms: ["fused_moe", "fusedmoe", "moe", "expert parallel", "all-to-all", "grouped matmul"],
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
    terms: ["model runner", "model_runner", "inputbatch", "input_batch", "aclgraph", "graph capture"],
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
    terms: ["scheduler", "preemption", "kv cache manager", "block table", "spec decode"],
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
    terms: ["attention", "mla", "prefix cache", "flash attention", "paged kv"],
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
    terms: ["distributed", "collective rpc", "multiproc", "hccl", "tensor parallel", "multi-node"],
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
    terms: ["api server", "openai api", "serving", "chat completion", "request router"],
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
    terms: ["model support", "new model", "model implementation", "weight loader"],
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

function githubHeaders(env: WorkerEnv, accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    accept,
    "user-agent": "LoongBoard/1.0",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function githubFetch<T>(
  env: WorkerEnv,
  path: string,
  accept?: string,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(env, accept),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new HttpError(502, `GitHub API 调用失败（${response.status}）`, detail);
  }
  if (accept?.includes("diff")) return (await response.text()) as T;
  return (await response.json()) as T;
}

async function githubGraphqlFetch<T>(
  env: WorkerEnv,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!env.GITHUB_TOKEN) {
    throw new HttpError(503, "GitHub GraphQL 需要配置访问令牌");
  }
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...githubHeaders(env),
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json() as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    const detail =
      payload.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `GitHub GraphQL 调用失败（${response.status}）`;
    throw new HttpError(502, "GitHub GraphQL 调用失败", detail.slice(0, 500));
  }
  return payload.data;
}

async function fetchRecentIssues(
  env: WorkerEnv,
  base: string,
  targetCount = 30,
) {
  const issues: any[] = [];
  const perPage = 100;
  const maxPages = 3;
  for (let page = 1; page <= maxPages && issues.length < targetCount; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `${base}/issues?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
    );
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < perPage) break;
  }
  return issues.slice(0, targetCount);
}

function normalizeCheckStatus(
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

function mergeChecks(checks: ReviewCheck[]) {
  const byName = new Map<string, ReviewCheck>();
  for (const check of checks) {
    const key = check.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing || existing.status === "pending") byName.set(key, check);
  }
  return [...byName.values()];
}

function normalizeReviewDecision(
  value: string | null | undefined,
): ReviewSignal["reviewDecision"] {
  const normalized = (value ?? "").toUpperCase();
  if (normalized === "APPROVED") return "approved";
  if (normalized === "CHANGES_REQUESTED") return "changes_requested";
  if (normalized === "REVIEW_REQUIRED") return "review_required";
  return "unknown";
}

function normalizeMergeability(
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

type PullSyncSnapshot = {
  diff: {
    files: number;
    additions: number;
    deletions: number;
    entries: Array<{ path: string; additions: number; deletions: number }>;
    source: "graphql-files";
    complete: boolean;
    statsOnly: true;
    notice: string;
  };
  reviewFacts: PullReviewFacts;
};

async function fetchPullSyncSnapshots(
  env: WorkerEnv,
  owner: string,
  name: string,
) {
  const snapshots = new Map<number, PullSyncSnapshot>();
  if (!env.GITHUB_TOKEN) return snapshots;
  const graphql = `
    query PullReviewSignals($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(
          first: 30
          states: [OPEN, CLOSED, MERGED]
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          nodes {
            number
            state
            isDraft
            mergeable
            reviewDecision
            changedFiles
            additions
            deletions
            files(first: 100) {
              nodes {
                path
                additions
                deletions
              }
              pageInfo {
                hasNextPage
              }
            }
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    state
                    contexts(first: 50) {
                      nodes {
                        ... on CheckRun {
                          name
                          status
                          conclusion
                          detailsUrl
                        }
                        ... on StatusContext {
                          context
                          state
                          targetUrl
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await githubGraphqlFetch<{
    repository?: {
      pullRequests: {
        nodes: Array<Record<string, any> | null>;
      };
    } | null;
  }>(env, graphql, { owner, name });

  for (const pull of data.repository?.pullRequests.nodes ?? []) {
    if (!pull?.number) continue;
    const contexts =
      pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
    const checks = mergeChecks(
      contexts
        .filter(Boolean)
        .map((context: Record<string, any>) => ({
          name: context.name || context.context || "未命名检查",
          status: normalizeCheckStatus(context.status || context.state, context.conclusion),
          url: context.detailsUrl || context.targetUrl || undefined,
        })),
    );
    const rollupState =
      pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? "";
    const entries = (pull.files?.nodes ?? [])
      .filter(Boolean)
      .map((file: Record<string, any>) => ({
        path: String(file.path ?? ""),
        additions: Number(file.additions ?? 0),
        deletions: Number(file.deletions ?? 0),
      }));
    snapshots.set(Number(pull.number), {
      diff: {
        files: Number(pull.changedFiles ?? entries.length),
        additions: Number(pull.additions ?? 0),
        deletions: Number(pull.deletions ?? 0),
        entries,
        source: "graphql-files",
        complete: !pull.files?.pageInfo?.hasNextPage,
        statsOnly: true,
        notice: pull.files?.pageInfo?.hasNextPage
          ? "同步阶段已分析前 100 个修改文件；打开详情可补齐全部文件统计。"
          : "同步阶段已获取修改文件统计；具体代码仍按需加载。",
      },
      reviewFacts: {
        state: String(pull.state ?? "").toLowerCase(),
        draft: Boolean(pull.isDraft),
        mergeability: normalizeMergeability(pull.mergeable),
        reviewDecision: normalizeReviewDecision(pull.reviewDecision),
        changedFiles: Number(pull.changedFiles ?? entries.length),
        additions: Number(pull.additions ?? 0),
        deletions: Number(pull.deletions ?? 0),
        checks,
        ciStatus: normalizeCiStatus(
          checks,
          String(rollupState).toUpperCase() === "SUCCESS"
            ? "success"
            : String(rollupState).toUpperCase() === "FAILURE"
              ? "failure"
              : rollupState
                ? "pending"
                : "unknown",
        ),
        source: "github-graphql",
      },
    });
  }
  return snapshots;
}

function confidenceLabel(value: number): DomainAssessment["confidenceLabel"] {
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
    if (
      rule.domain === "Tests" &&
      pathScore === 0 &&
      !hasTitleTerm
    ) {
      textScore = 0;
      matchedTerms.clear();
    }

    // Tests/docs/CI describe the change type more than its technical area. They
    // become the primary domain only when no stronger technical path matches.
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

function normalizeCiStatus(
  checks: ReviewCheck[],
  fallback?: ReviewSignal["ciStatus"],
): ReviewSignal["ciStatus"] {
  if (checks.some((check) => check.status === "failure")) return "failure";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.length && checks.every((check) =>
    ["success", "neutral"].includes(check.status))) return "success";
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
  if (domain !== "Other" && !["Documentation", "Tests", "CI / Infra"].includes(domain)) {
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

function itemId(repoId: string, kind: string, number: number) {
  return `${repoId}:${kind}:${number}`;
}

async function stableHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function recordEvent(
  env: WorkerEnv,
  input: {
    repoId: string;
    itemId: string;
    eventType:
      | "opened"
      | "updated"
      | "draft"
      | "ready_for_review"
      | "merged"
      | "closed"
      | "reopened";
    occurredAt: string;
    source: "github" | "sync";
    actor?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  if (!input.occurredAt) return;
  await run(
    env,
    `INSERT INTO community_events(
      id, repo_id, item_id, event_type, occurred_at, observed_at,
      source, actor, metadata_json
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id, event_type, occurred_at) DO NOTHING`,
    [
      crypto.randomUUID(),
      input.repoId,
      input.itemId,
      input.eventType,
      input.occurredAt,
      new Date().toISOString(),
      input.source,
      input.actor ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function upsertCommunityItem(
  env: WorkerEnv,
  repoId: string,
  kind: "pr" | "issue",
  item: any,
  snapshot?: PullSyncSnapshot,
) {
  const title = item.title ?? "";
  const body = item.body ?? "";
  const domainAssessment = classifyDomain({
    title,
    body,
    files: snapshot?.diff.entries,
  });
  const domain = domainAssessment.domain;
  const state =
    kind === "pr" && item.merged_at
      ? "merged"
      : kind === "pr" && item.draft
        ? "draft"
        : item.state;
  const statusText =
    state === "merged"
      ? "Merged"
      : state === "draft"
        ? "Draft"
        : state === "closed"
          ? "Closed"
          : kind === "pr"
            ? "Review required"
            : "Open";
  const importanceText = `${title}\n${body}`.replace(
    /\b(?:accuracy\s+)?regression tests?\b/gi,
    "",
  );
  const important =
    /regression|breaking change|security|critical|cve|data loss|performance drop|回归|安全|破坏性/i.test(
      importanceText,
    ) ? 1 : 0;
  const id = itemId(repoId, kind, item.number);
  const now = new Date().toISOString();
  const contentHash = await stableHash(`${title}\n${body}\n${state}`);
  const existing = await first<Record<string, any>>(
    env,
    "SELECT * FROM community_items WHERE id = ?",
    [id],
  );
  const contentChanged = existing?.content_hash !== contentHash;
  const excerpt = fallbackSummary(title, body, domain);

  await run(
    env,
    `INSERT INTO community_items (
      id, repo_id, kind, number, state, title, author, author_avatar, body_md,
      html_url, comments, domain, ai_summary, status_text, important, updated_at,
      created_at, merged_at, closed_at, is_draft, content_hash,
      summary_input_hash, summary_source, summary_updated_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state = excluded.state,
      title = excluded.title,
      author = excluded.author,
      author_avatar = excluded.author_avatar,
      body_md = excluded.body_md,
      html_url = excluded.html_url,
      comments = excluded.comments,
      domain = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.domain
        WHEN community_items.summary_source = 'ai'
          THEN community_items.domain
        ELSE excluded.domain
      END,
      ai_summary = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.ai_summary
        WHEN community_items.summary_source = 'ai'
          THEN community_items.ai_summary
        ELSE excluded.ai_summary
      END,
      status_text = excluded.status_text,
      important = excluded.important,
      diff_json = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN NULL ELSE community_items.diff_json END,
      diff_files_count = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN 0 ELSE community_items.diff_files_count END,
      additions = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN 0 ELSE community_items.additions END,
      deletions = CASE WHEN community_items.updated_at != excluded.updated_at
        THEN 0 ELSE community_items.deletions END,
      created_at = COALESCE(excluded.created_at, community_items.created_at),
      updated_at = excluded.updated_at,
      merged_at = excluded.merged_at,
      closed_at = excluded.closed_at,
      is_draft = excluded.is_draft,
      content_hash = excluded.content_hash,
      summary_input_hash = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.summary_input_hash
        ELSE community_items.summary_input_hash
      END,
      summary_source = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN 'excerpt'
        ELSE community_items.summary_source
      END,
      summary_updated_at = CASE
        WHEN community_items.content_hash != excluded.content_hash
          THEN excluded.summary_updated_at
        ELSE community_items.summary_updated_at
      END,
      fetched_at = excluded.fetched_at`,
    [
      id,
      repoId,
      kind,
      item.number,
      state,
      title,
      item.user?.login ?? "unknown",
      item.user?.avatar_url ?? null,
      body,
      item.html_url ?? null,
      Number(item.comments ?? 0),
      domain,
      excerpt,
      statusText,
      important,
      item.updated_at ?? new Date().toISOString(),
      item.created_at ?? null,
      item.merged_at ?? null,
      item.closed_at ?? null,
      item.draft ? 1 : 0,
      contentHash,
      contentHash,
      "excerpt",
      now,
      now,
    ],
  );
  const reviewSignal =
    kind === "pr"
      ? buildReviewSignal(
          {
            state,
            draft: Boolean(item.draft),
            comments: Number(item.comments ?? 0),
            source: snapshot ? "github-graphql" : "metadata",
            ...snapshot?.reviewFacts,
          },
          domain,
        )
      : null;
  await run(
    env,
    `UPDATE community_items SET
      domain = ?, domain_source = ?, domain_confidence = ?,
      domain_evidence_json = ?, review_signal_json = ?,
      review_signal_updated_at = ?,
      diff_json = CASE WHEN ? IS NULL THEN diff_json ELSE ? END,
      diff_files_count = CASE WHEN ? IS NULL THEN diff_files_count ELSE ? END,
      additions = CASE WHEN ? IS NULL THEN additions ELSE ? END,
      deletions = CASE WHEN ? IS NULL THEN deletions ELSE ? END
     WHERE id = ?`,
    [
      domain,
      domainAssessment.source,
      domainAssessment.confidence,
      JSON.stringify(domainAssessment),
      reviewSignal ? JSON.stringify(reviewSignal) : "{}",
      reviewSignal?.updatedAt ?? null,
      snapshot ? "available" : null,
      snapshot ? JSON.stringify(snapshot.diff) : null,
      snapshot ? "available" : null,
      snapshot?.diff.files ?? 0,
      snapshot ? "available" : null,
      snapshot?.diff.additions ?? 0,
      snapshot ? "available" : null,
      snapshot?.diff.deletions ?? 0,
      id,
    ],
  );

  const occurredAt = item.updated_at ?? now;
  if (!existing && item.created_at) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "opened",
      occurredAt: item.created_at,
      source: "github",
      actor: item.user?.login,
    });
  }
  if (!existing && state === "draft") {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "draft",
      occurredAt: item.created_at ?? occurredAt,
      source: "sync",
      actor: item.user?.login,
    });
  }
  if (!existing && state === "merged" && item.merged_at) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "merged",
      occurredAt: item.merged_at,
      source: "github",
      actor: item.merged_by?.login,
    });
  } else if (!existing && state === "closed" && item.closed_at) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "closed",
      occurredAt: item.closed_at,
      source: "github",
      actor: item.closed_by?.login,
    });
  }
  if (existing) {
    if (existing.state === "closed" && ["open", "draft"].includes(state)) {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "reopened",
        occurredAt,
        source: "sync",
      });
    }
    if (existing.state !== "merged" && state === "merged") {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "merged",
        occurredAt: item.merged_at ?? occurredAt,
        source: item.merged_at ? "github" : "sync",
      });
    } else if (
      !["closed", "merged"].includes(existing.state) &&
      state === "closed"
    ) {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "closed",
        occurredAt: item.closed_at ?? occurredAt,
        source: item.closed_at ? "github" : "sync",
      });
    }
    if (!existing.is_draft && item.draft) {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "draft",
        occurredAt,
        source: "sync",
      });
    } else if (existing.is_draft && !item.draft && state === "open") {
      await recordEvent(env, {
        repoId,
        itemId: id,
        eventType: "ready_for_review",
        occurredAt,
        source: "sync",
      });
    }
  }
  if (!existing || existing.updated_at !== occurredAt || contentChanged) {
    await recordEvent(env, {
      repoId,
      itemId: id,
      eventType: "updated",
      occurredAt,
      source: "sync",
    });
  }
  return { id, contentHash, contentChanged };
}

async function captureRecentRepositoryEvents(
  env: WorkerEnv,
  repoId: string,
  base: string,
) {
  let events: any[] = [];
  try {
    events = await githubFetch<any[]>(
      env,
      `${base}/issues/events?per_page=100`,
    );
  } catch {
    return 0;
  }
  let captured = 0;
  for (const event of events) {
    if (!["closed", "reopened", "merged"].includes(event.event)) continue;
    const issue = event.issue;
    if (!issue?.number || !event.created_at) continue;
    const kind = issue.pull_request ? "pr" : "issue";
    const row = await first<{ id: string }>(
      env,
      `SELECT id FROM community_items
       WHERE repo_id = ? AND kind = ? AND number = ?`,
      [repoId, kind, issue.number],
    );
    if (!row) continue;
    await recordEvent(env, {
      repoId,
      itemId: row.id,
      eventType: event.event,
      occurredAt: event.created_at,
      source: "github",
      actor: event.actor?.login,
      metadata: { eventId: event.id ?? null },
    });
    captured += 1;
  }
  return captured;
}

async function updatePendingSummaries(
  env: WorkerEnv,
  repoId: string,
  userId: string,
) {
  const rows = await query<Record<string, any>>(
    env,
    `SELECT id, kind, state, title, body_md, content_hash
     FROM community_items
     WHERE repo_id = ? AND summary_source != 'ai'
     ORDER BY updated_at DESC
     LIMIT 30`,
    [repoId],
  );
  if (!rows.length) {
    return { analyzed: 0, provider: "none", providerName: "", warning: "" };
  }
  let analyzed = 0;
  let provider = "fallback";
  let providerName = "";
  for (let index = 0; index < rows.length; index += 10) {
    const batch = rows.slice(index, index + 10);
    const result = await summarizeCommunityBatch(env, {
      userId,
      language: "zh",
      items: batch.map((row) => ({
        id: row.id,
        kind: row.kind,
        state: row.state,
        title: row.title,
        bodyMd: row.body_md,
      })),
    });
    provider = result.provider;
    providerName = result.providerName;
    if (result.provider !== "api") break;
    for (const summary of result.summaries) {
      const source = batch.find((row) => row.id === summary.id);
      if (!source) continue;
      await run(
        env,
        `UPDATE community_items SET
          ai_summary = ?, important = ?,
          summary_source = 'ai', summary_input_hash = ?,
          summary_updated_at = ?
         WHERE id = ? AND content_hash = ?`,
        [
          summary.summary,
          summary.important ? 1 : 0,
          source.content_hash,
          new Date().toISOString(),
          summary.id,
          source.content_hash,
        ],
      );
      analyzed += 1;
    }
  }
  return {
    analyzed,
    provider,
    providerName,
    warning:
      provider === "fallback"
        ? "当前账户未配置可用 AI，列表显示正文摘录。"
        : "",
  };
}

export async function syncRepository(
  env: WorkerEnv,
  repoId: string,
  userId?: string,
) {
  const repository = await first<Record<string, any>>(
    env,
    "SELECT * FROM repositories WHERE id = ?",
    [repoId],
  );
  if (!repository) throw new HttpError(404, "仓库不存在");

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await run(
    env,
    "INSERT INTO sync_runs(id, repo_id, status, started_at) VALUES(?, ?, 'running', ?)",
    [runId, repoId, startedAt],
  );
  await run(env, "UPDATE repositories SET sync_status = 'syncing' WHERE id = ?", [
    repoId,
  ]);

  try {
    const base = `/repos/${repository.owner}/${repository.name}`;
    const [pulls, realIssues] = await Promise.all([
      githubFetch<any[]>(
        env,
        `${base}/pulls?state=all&sort=updated&direction=desc&per_page=30`,
      ),
      fetchRecentIssues(env, base),
    ]);

    let pullSnapshots = new Map<number, PullSyncSnapshot>();
    let reviewSignalWarning = "";
    if (env.GITHUB_TOKEN) {
      try {
        pullSnapshots = await fetchPullSyncSnapshots(
          env,
          repository.owner,
          repository.name,
        );
      } catch (error) {
        reviewSignalWarning =
          error instanceof Error
            ? `PR Review 信号批量采集失败，已保留基础判断：${error.message}`
            : "PR Review 信号批量采集失败，已保留基础判断";
      }
    }

    for (const pull of pulls) {
      await upsertCommunityItem(
        env,
        repoId,
        "pr",
        pull,
        pullSnapshots.get(Number(pull.number)),
      );
    }
    for (const issue of realIssues) {
      await upsertCommunityItem(env, repoId, "issue", issue);
    }
    const capturedEvents = await captureRecentRepositoryEvents(env, repoId, base);
    let summaryResult = {
      analyzed: 0,
      provider: "none",
      providerName: "",
      warning: "",
    };
    if (userId) {
      try {
        summaryResult = await updatePendingSummaries(env, repoId, userId);
      } catch (error) {
        summaryResult.warning =
          error instanceof Error
            ? `AI 摘要已停止：${error.message}`
            : "AI 摘要已停止：未知错误";
      }
    }

    // Sidebar counts describe the bounded snapshot this dashboard actually
    // synchronized. Repository-wide GitHub totals can be thousands of items and
    // do not match the recent records available in the local list.
    const syncedPullCount = pulls.length;
    const syncedIssueCount = realIssues.length;

    const finishedAt = new Date().toISOString();
    await run(
      env,
      `UPDATE repositories SET
        open_pull_count = ?, open_issue_count = ?, last_synced_at = ?,
        sync_status = 'ready'
      WHERE id = ?`,
      [
        syncedPullCount,
        syncedIssueCount,
        finishedAt,
        repoId,
      ],
    );
    await run(
      env,
      `UPDATE sync_runs SET status = 'ready', item_count = ?, finished_at = ?
       WHERE id = ?`,
      [pulls.length + realIssues.length, finishedAt, runId],
    );
    await run(env, "DELETE FROM analysis_documents WHERE model = 'seed'");
    return {
      id: runId,
      repository: repoId,
      pulls: pulls.length,
      issues: realIssues.length,
      capturedEvents,
      analyzed: summaryResult.analyzed,
      summaryProvider: summaryResult.provider,
      summaryProviderName: summaryResult.providerName,
      reviewSignals: pullSnapshots.size,
      warning: [summaryResult.warning, reviewSignalWarning].filter(Boolean).join("；"),
      finishedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知同步错误";
    const finishedAt = new Date().toISOString();
    await run(
      env,
      "UPDATE repositories SET sync_status = 'failed' WHERE id = ?",
      [repoId],
    );
    await run(
      env,
      `UPDATE sync_runs SET status = 'failed', error = ?, finished_at = ?
       WHERE id = ?`,
      [message.slice(0, 500), finishedAt, runId],
    );
    throw error;
  }
}

export function parseUnifiedDiff(rawDiff: string) {
  const entries: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch: string;
  }> = [];
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
    source: "raw-diff",
    complete: true,
  };
}

async function fetchPullFileStats(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
) {
  if (env.GITHUB_TOKEN) {
    try {
      const entries: Array<{
        path: string;
        additions: number;
        deletions: number;
      }> = [];
      let cursor: string | null = null;
      let files = 0;
      let additions = 0;
      let deletions = 0;
      let hasNextPage = true;
      const query = `
        query PullFileStats(
          $owner: String!
          $name: String!
          $number: Int!
          $cursor: String
        ) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              changedFiles
              additions
              deletions
              files(first: 100, after: $cursor) {
                nodes {
                  path
                  additions
                  deletions
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }
      `;

      while (hasNextPage && entries.length < 3_000) {
        const data = await githubGraphqlFetch<{
          repository?: {
            pullRequest?: {
              changedFiles: number;
              additions: number;
              deletions: number;
              files: {
                nodes: Array<{
                  path: string;
                  additions: number;
                  deletions: number;
                } | null>;
                pageInfo: {
                  hasNextPage: boolean;
                  endCursor: string | null;
                };
              };
            } | null;
          } | null;
        }>(env, query, { owner, name, number, cursor });
        const pull = data.repository?.pullRequest;
        if (!pull) throw new HttpError(404, "Pull Request 不存在");
        files = Number(pull.changedFiles ?? 0);
        additions = Number(pull.additions ?? 0);
        deletions = Number(pull.deletions ?? 0);
        entries.push(
          ...pull.files.nodes
            .filter((file): file is NonNullable<typeof file> => Boolean(file))
            .map((file) => ({
              path: file.path,
              additions: Number(file.additions ?? 0),
              deletions: Number(file.deletions ?? 0),
            })),
        );
        hasNextPage = pull.files.pageInfo.hasNextPage;
        cursor = pull.files.pageInfo.endCursor;
      }

      return {
        files,
        additions,
        deletions,
        entries,
        source: "graphql-files",
        complete: !hasNextPage,
        statsOnly: true,
        notice: "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
      };
    } catch {
      // Public repositories still support a REST fallback. Patch fields returned
      // by GitHub are discarded immediately and are never stored or sent here.
    }
  }

  const entries: Array<{
    path: string;
    additions: number;
    deletions: number;
  }> = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    entries.push(
      ...batch.map((file) => ({
        path: file.filename,
        additions: Number(file.additions ?? 0),
        deletions: Number(file.deletions ?? 0),
      })),
    );
    if (batch.length < 100) break;
  }
  return {
    files: entries.length,
    additions: entries.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: entries.reduce((sum, entry) => sum + entry.deletions, 0),
    entries,
    source: "files-api-stat",
    complete: entries.length < 3_000,
    statsOnly: true,
    notice: "当前仅展示文件变更统计；点击“获取代码修改”后统一获取可查看的代码内容。",
  };
}

async function optionalGithubFetch<T>(
  env: WorkerEnv,
  path: string,
): Promise<T | null> {
  try {
    return await githubFetch<T>(env, path);
  } catch {
    return null;
  }
}

async function fetchPullReviewFacts(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
): Promise<PullReviewFacts> {
  const base = `/repos/${owner}/${name}`;
  const pull = await githubFetch<Record<string, any>>(
    env,
    `${base}/pulls/${number}`,
  );
  const headSha = String(pull.head?.sha ?? "");
  const baseSha = String(pull.base?.sha ?? "");
  const [checkRuns, commitStatus, comparison, reviews] = await Promise.all([
    headSha
      ? optionalGithubFetch<{ check_runs?: Array<Record<string, any>> }>(
          env,
          `${base}/commits/${headSha}/check-runs?per_page=100`,
        )
      : null,
    headSha
      ? optionalGithubFetch<{ statuses?: Array<Record<string, any>> }>(
          env,
          `${base}/commits/${headSha}/status`,
        )
      : null,
    baseSha && headSha
      ? optionalGithubFetch<{ behind_by?: number }>(
          env,
          `${base}/compare/${baseSha}...${headSha}`,
        )
      : null,
    optionalGithubFetch<Array<Record<string, any>>>(
      env,
      `${base}/pulls/${number}/reviews?per_page=100`,
    ),
  ]);

  const checks = mergeChecks([
    ...(checkRuns?.check_runs ?? []).map((check) => ({
      name: String(check.name ?? "未命名检查"),
      status: normalizeCheckStatus(check.status, check.conclusion),
      url: check.details_url || check.html_url || undefined,
    })),
    ...(commitStatus?.statuses ?? []).map((status) => ({
      name: String(status.context ?? "Commit status"),
      status: normalizeCheckStatus(status.state),
      url: status.target_url || undefined,
    })),
  ]);

  const latestReviewByUser = new Map<string, Record<string, any>>();
  for (const review of reviews ?? []) {
    const user = String(review.user?.login ?? review.id ?? "");
    latestReviewByUser.set(user, review);
  }
  const reviewStates = [...latestReviewByUser.values()].map((review) =>
    String(review.state ?? "").toUpperCase(),
  );
  const reviewDecision: ReviewSignal["reviewDecision"] =
    reviewStates.includes("CHANGES_REQUESTED")
      ? "changes_requested"
      : reviewStates.includes("APPROVED")
        ? "approved"
        : Number(pull.requested_reviewers?.length ?? 0) > 0 ||
            Number(pull.requested_teams?.length ?? 0) > 0
          ? "review_required"
          : "unknown";

  return {
    state: pull.merged_at ? "merged" : pull.state,
    draft: Boolean(pull.draft),
    mergeability: normalizeMergeability(
      pull.mergeable,
      String(pull.mergeable_state ?? ""),
    ),
    mergeState: String(pull.mergeable_state ?? ""),
    reviewDecision,
    behindBy:
      comparison?.behind_by === undefined
        ? null
        : Number(comparison.behind_by),
    changedFiles: Number(pull.changed_files ?? 0),
    additions: Number(pull.additions ?? 0),
    deletions: Number(pull.deletions ?? 0),
    comments:
      Number(pull.comments ?? 0) + Number(pull.review_comments ?? 0),
    checks,
    ciStatus: normalizeCiStatus(checks),
    source: "github-rest",
  };
}

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

async function fetchPullPatches(
  env: WorkerEnv,
  owner: string,
  name: string,
  number: number,
  eligiblePaths: Set<string>,
) {
  const patches = new Map<string, string>();
  try {
    const rawDiff = await githubFetch<string>(
      env,
      `/repos/${owner}/${name}/pulls/${number}`,
      "application/vnd.github.v3.diff",
    );
    for (const entry of parseUnifiedDiff(rawDiff).entries) {
      if (eligiblePaths.has(entry.path)) {
        patches.set(entry.path, entry.patch);
      }
    }
  } catch {
    // Fall through to the paginated files API when GitHub cannot serve raw diff.
  }

  if (patches.size === eligiblePaths.size) return patches;

  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubFetch<any[]>(
      env,
      `/repos/${owner}/${name}/pulls/${number}/files?per_page=100&page=${page}`,
    );
    for (const file of batch) {
      if (
        !eligiblePaths.has(file.filename) ||
        patches.has(file.filename)
      ) {
        continue;
      }
      const metadata = [
        `diff --git a/${file.previous_filename ?? file.filename} b/${file.filename}`,
        `status: ${file.status}`,
      ];
      patches.set(
        file.filename,
        typeof file.patch === "string" && file.patch
          ? `${metadata.join("\n")}\n${file.patch}`
          : `${metadata.join("\n")}\n[GitHub 未返回文本 patch：该文件可能是二进制文件，或其 diff 超出 GitHub API 返回限制。]\nsource: ${file.raw_url ?? file.blob_url ?? "unavailable"}`,
      );
    }
    if (patches.size === eligiblePaths.size) break;
    if (batch.length < 100) break;
  }
  return patches;
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

export function diffToText(diff: any) {
  if (!diff) return "代码修改尚未按需获取";
  if (diff.statsOnly) {
    return `${diff.files ?? 0} files changed, ${diff.additions ?? 0} insertions(+), ${diff.deletions ?? 0} deletions(-)`;
  }
  if (typeof diff.raw === "string") return diff.raw;
  return (diff.entries ?? [])
    .map((entry: any) => `diff -- ${entry.path}\n${entry.patch ?? ""}`)
    .join("\n\n");
}
