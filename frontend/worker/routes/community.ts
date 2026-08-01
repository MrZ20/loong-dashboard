import { analyzeCommunityItem } from "../ai";
import { requireUser } from "../auth";
import {
  mapAnalysis,
  mapCommunityItem,
  parseJson,
  type WorkerEnv,
} from "../db";
import {
  diffToText,
  ensurePullPatches,
  ensurePullStats,
} from "../github";
import {
  cleanText,
  HttpError,
  json,
  readJson,
} from "../http";
import {
  createCommunityAnalysis,
  findCommunityRow,
  listCommunityAnalysisRows,
  listCommunityRows,
} from "../repositories/community";

function toIsoDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export async function listCommunity(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo");
  const kindValue = url.searchParams.get("kind");
  const kind =
    kindValue === "pr" || kindValue === "issue" ? kindValue : null;
  const domain = url.searchParams.get("domain");
  const state = url.searchParams.get("state");
  const search = url.searchParams.get("q")?.trim();
  const since = toIsoDate(url.searchParams.get("since"));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 200);

  const rows = await listCommunityRows(env, {
    repo,
    kind,
    domain,
    state,
    search,
    since,
    limit,
  });
  return json({
    items: rows.map((row) => mapCommunityItem(row)),
    total: rows.length,
  });
}

export async function getCommunityItem(
  request: Request,
  env: WorkerEnv,
  repo: string,
  kind: string,
  numberValue: string,
) {
  const number = Number(numberValue);
  if (!Number.isInteger(number)) throw new HttpError(400, "编号不正确");
  let item = await findCommunityRow(env, repo, kind, number);
  if (!item) throw new HttpError(404, "社区条目不存在");

  if (kind === "pr") {
    const refreshed = await ensurePullStats(env, repo, number);
    item = {
      ...item,
      diff_json: JSON.stringify(refreshed.diff),
      domain: refreshed.domain,
      domain_source: refreshed.domainAssessment?.source ?? item.domain_source,
      domain_confidence:
        refreshed.domainAssessment?.confidence ?? item.domain_confidence,
      domain_evidence_json: JSON.stringify(
        refreshed.domainAssessment ?? {},
      ),
      review_signal_json: JSON.stringify(refreshed.reviewSignal ?? {}),
      review_signal_updated_at:
        refreshed.reviewSignalUpdatedAt ?? item.review_signal_updated_at,
    };
  }

  const analyses = await listCommunityAnalysisRows(
    env,
    kind,
    `${repo}:${kind}:${number}`,
  );
  return json({
    item: mapCommunityItem(
      item,
      kind === "pr" ? "stats" : "none",
    ),
    analyses: analyses.map(mapAnalysis),
  });
}

export async function getCommunityDiffFiles(
  env: WorkerEnv,
  repo: string,
  numberValue: string,
) {
  const number = Number(numberValue);
  if (!Number.isInteger(number)) throw new HttpError(400, "编号不正确");
  return json(await ensurePullPatches(env, repo, number));
}

export async function analyzeItem(
  request: Request,
  env: WorkerEnv,
  repo: string,
  kind: string,
  numberValue: string,
) {
  const user = await requireUser(request, env);
  const body = await readJson<{ prompt?: string }>(request);
  const number = Number(numberValue);
  const row = await findCommunityRow(env, repo, kind, number);
  if (!row) throw new HttpError(404, "社区条目不存在");
  let diff = parseJson<{
    entries?: Array<{ path: string; additions: number; deletions: number }>;
    files?: number;
    additions?: number;
    deletions?: number;
  } | null>(row.diff_json, null);
  let analysisDiffText = diffToText(diff);
  if (kind === "pr") {
    const refreshed = await ensurePullStats(env, repo, number);
    diff = refreshed.diff ?? null;
    const patches = await ensurePullPatches(env, repo, number);
    const domainAssessment = refreshed.domainAssessment;
    const reviewSignal = refreshed.reviewSignal;
    analysisDiffText = [
      domainAssessment
        ? [
            `领域判断：${domainAssessment.domain}`,
            `判断来源：${domainAssessment.source}`,
            `置信度：${Math.round(Number(domainAssessment.confidence ?? 0) * 100)}%`,
            domainAssessment.matchedPaths?.length
              ? `路径证据：${domainAssessment.matchedPaths.join(", ")}`
              : "路径证据：尚未命中已配置规则",
          ].join("\n")
        : "",
      reviewSignal
        ? [
            `Review 建议：${reviewSignal.label}`,
            `CI：${reviewSignal.ciStatus}`,
            `合并状态：${reviewSignal.mergeability}`,
            `Review 决策：${reviewSignal.reviewDecision}`,
            `落后目标分支：${reviewSignal.behindBy ?? "未知"}`,
            `事实依据：${reviewSignal.reasons?.join("；") || "信号待补全"}`,
          ].join("\n")
        : "",
      diffToText(diff),
      ...patches.entries.map(
        (entry) =>
          `diff -- ${entry.path}\n${entry.patch ?? "[GitHub 未返回文本 patch]"}`,
      ),
      patches.skippedLarge
        ? `${patches.skippedLarge} 个超过 1000 行的文件未读取代码内容。`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const fallback = `# ${row.title} · 深度分析

## 改动目的

${row.ai_summary || "该条目尚未生成 AI 摘要。"}

## 本次关注点

${cleanText(body.prompt, 5_000) || "未提供额外分析要求。"}

## 实现与代码路径

${diff?.entries?.length
  ? diff.entries.map((entry: any) => `- \`${entry.path}\`：+${entry.additions} / -${entry.deletions}`).join("\n")
  : "- 尚未按需获取代码 diff；当前分析仅依据标题与 Markdown 正文。"}

## 兼容性与风险

- 需要结合正文和测试结果确认真实影响。
- 涉及设备扩展点时，应对照 vLLM 与 vLLM-Ascend 的对应路径。

## 建议动作

1. 当前未配置模型；请在详情页点击“获取代码修改”后人工核对具体实现。
2. 核对新增测试是否覆盖多卡和异常路径。
3. 对仍缺少证据的判断标记为待确认。`;
  const result = await analyzeCommunityItem(env, {
    userId: user.id,
    title: row.title,
    bodyMd: row.body_md,
    diffText: analysisDiffText,
    prompt: cleanText(body.prompt, 5_000),
    fallback,
  });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const scope = `${repo}:${kind}:${number}`;
  const saved = await createCommunityAnalysis(env, {
    id,
    kind,
    scope,
    title: `${row.title} · 深度分析`,
    summaryMd: result.content.split("\n\n")[0].slice(0, 500),
    contentMd: result.content,
    prompt: cleanText(body.prompt, 5_000),
    model: result.model,
    userId: user.id,
    createdAt: now,
  });
  return json(
    {
      analysis: mapAnalysis(saved!),
      provider: result.provider,
      providerName: result.providerName,
    },
    { status: 201 },
  );
}

