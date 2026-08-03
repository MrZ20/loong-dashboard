import { generateAnalysisDocument } from "../ai";
import { requireUser } from "../auth";
import {
  mapAnalysis,
  type WorkerEnv,
} from "../db";
import { deduplicateObservedEvents } from "../intelligence";
import {
  cleanText,
  json,
  readJson,
} from "../http";
import {
  createGeneratedAnalysisRow,
  listAnalysisImpactRows,
  listAnalysisWatchRows,
  listDailyAnalysisRows,
  listRecentAnalysisRows,
} from "../repositories/analysis";
import { beijingDate, beijingDayWindow } from "../time";
import { enqueueInsightLocalEvidence } from "../services/local-analysis";
import { enqueueManagedAITask } from "../services/local-analysis";
import { aiTaskKeyForFeature } from "../domain/ai-task-catalog";
import { resolveAITask } from "../services/ai-task-settings";

export async function generateAnalysis(request: Request, env: WorkerEnv) {
  const user = await requireUser(request, env);
  const body = await readJson<{
    type?: string;
    scope?: string;
    title?: string;
    useLocalCode?: boolean;
    targets?: unknown[];
    providerId?: string;
    modelId?: string;
  }>(request);
  const type = cleanText(body.type, 40) || "insight";
  const scope = cleanText(body.scope, 80) || "all";
  let taskKeyOverride: "local_code_insight" | undefined;
  if (body.useLocalCode === true) {
    const localTask = await resolveAITask(env, user.id, "local_code_insight");
    if (localTask.executionMode === "opencode") {
      const job = await enqueueInsightLocalEvidence(env, {
        userId: user.id,
        scope,
        title: cleanText(body.title, 200) || "包含本地代码证据的 AI 洞察",
        targets: Array.isArray(body.targets) ? body.targets : [],
        providerId: "",
        modelId: "",
      });
      return json({ job }, { status: 202 });
    }
    taskKeyOverride = "local_code_insight";
  }
  const dayWindow = type === "daily" ? beijingDayWindow() : null;
  const rawRows = dayWindow
    ? await listDailyAnalysisRows(
        env,
        scope,
        dayWindow.start,
        dayWindow.end,
      )
    : await listRecentAnalysisRows(env, scope);
  let rows = dayWindow
    ? deduplicateObservedEvents(rawRows)
    : rawRows;
  if (body.useLocalCode === true && Array.isArray(body.targets) && body.targets.length) {
    const selected = new Set(body.targets.flatMap((target: any) => {
      const repo = cleanText(target?.repo, 80);
      const kind = cleanText(target?.kind, 20);
      const number = Number(target?.number);
      return repo && kind && Number.isInteger(number) ? [`${repo}:${kind}:${number}`] : [];
    }));
    rows = rows.filter((row) => selected.has(`${row.repo_id}:${row.kind}:${row.number}`));
  }
  const [watchRows, impactRows] =
    type === "insight"
      ? await Promise.all([
          listAnalysisWatchRows(env, user.id),
          listAnalysisImpactRows(env),
        ])
      : [[], []];
  const domainCounts = new Map<string, number>();
  for (const item of rows) {
    if (item.domain && item.domain !== "Other") {
      domainCounts.set(item.domain, (domainCounts.get(item.domain) ?? 0) + 1);
    }
  }
  const communityEvidence = rows
    .map(
      (item) =>
        `- ${item.repo_id} ${item.kind} #${item.number} [${item.domain}] ${item.title}${
          item.event_type
            ? `\n  事件：${item.event_type} @ ${item.occurred_at}`
            : ""
        }\n  ${item.summary_source === "ai" ? "AI 摘要" : "正文摘录"}：${item.ai_summary}`,
    )
    .join("\n");
  const watchEvidence = watchRows
    .map(
      (item) =>
        `- ${item.priority} ${item.repo_id} ${item.kind} #${item.number}：${item.title}\n  关注原因：${item.reason}${item.note ? `；备注：${item.note}` : ""}`,
    )
    .join("\n");
  const impactEvidence = impactRows
    .map(
      (item) =>
        `- ${item.level}/${item.status} ${item.repo_id} ${item.kind} #${item.number} [${item.domain}]：${item.title}\n  ${item.analysis}`,
    )
    .join("\n");
  const domainEvidence = [...domainCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([domain, count]) => `- ${domain}：${count} 条活动记录`)
    .join("\n");
  const evidence = [
    `## 社区事项\n${communityEvidence || "- 暂无已同步事项"}`,
    type === "insight"
      ? `## 关注列表\n${watchEvidence || "- 暂无关注项"}`
      : "",
    type === "insight"
      ? `## 跨仓库影响\n${impactEvidence || "- 暂无待确认关系"}`
      : "",
    `## 领域活动\n${domainEvidence || "- 暂无可归类活动"}`,
    taskKeyOverride
      ? "## 本地代码证据状态\n- 当前任务使用直连 API，仅分析已保存的社区事实；没有读取本地源码，不得标记为本地代码证据。"
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const fallback = `# ${type === "daily" ? "每日社区分析" : "跨仓库 AI 洞察"}

## 执行摘要

当前服务未配置 AI API，以下内容由已同步的结构化信号生成。

## 重要变化

${rows.slice(0, 8).map((item) => `- **${item.repo_id}#${item.number}**：${item.title}`).join("\n") || "- 当前时间范围没有已同步事项。"}

${impactRows.length ? `## 跨仓库待确认\n\n${impactRows.slice(0, 5).map((item) => `- **${item.repo_id}#${item.number}**（${item.level}/${item.status}）：${item.analysis}`).join("\n")}` : ""}

## 风险与不确定性

- 尚未配置模型，无法对完整正文与代码 diff 做语义推断。
- GitHub 同步时间和 diff 完整度会影响分析结果。

## 建议动作

1. 配置 AI API 后重新生成本文档。
2. 先处理已标记为重点的回归和跨仓库适配关系。
3. 对结论保持人工确认。`;
  const reportDate = beijingDate();
  const title =
    cleanText(body.title, 200) ||
    `${type === "daily" ? `${scope} 每日分析` : "跨仓库 AI 洞察"} · ${reportDate}`;
  const sourceRefs = [
    ...rows.slice(0, 20).map((item) => `${item.repo_id}#${item.number}`),
    ...watchRows
      .slice(0, 10)
      .map((item) => `watch:${item.repo_id}#${item.number}`),
    ...impactRows
      .slice(0, 10)
      .map((item) => `impact:${item.repo_id}#${item.number}`),
  ];
  const taskKey = taskKeyOverride || aiTaskKeyForFeature(
    type === "daily" ? "daily_report" : "cross_repo_insight",
    scope,
  );
  const task = await resolveAITask(env, user.id, taskKey);
  if (task.executionMode === "opencode") {
    const job = await enqueueManagedAITask(env, {
      userId: user.id,
      taskKey,
      purpose: "analysis_document",
      subjectKind: type,
      subjectKey: `${type}:${scope}:${reportDate}`,
      repoScope: scope === "vllm" || scope === "vllm-ascend" ? scope : "all",
      request: {
        evidence,
        fallback,
        document: { type, scope, title, sourceRefs },
      },
    });
    return json({ job }, { status: 202 });
  }
  const result = await generateAnalysisDocument(env, {
    userId: user.id,
    type,
    scope,
    evidence,
    fallback,
    taskKey: taskKeyOverride,
  });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const saved = await createGeneratedAnalysisRow(env, {
    id,
    type,
    scope,
    title,
    summaryMd: result.content
      .split("\n\n")
      .slice(0, 2)
      .join("\n\n")
      .slice(0, 1_000),
    contentMd: result.content,
    prompt: result.prompt.instruction,
    promptTemplateId: result.prompt.templateId,
    promptTemplateName: result.prompt.name,
    promptRevision: result.prompt.revision,
    model: result.model,
    userId: user.id,
    sourceRefs,
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
