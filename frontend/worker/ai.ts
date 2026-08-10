import type { WorkerEnv } from "./db";
import { HttpError } from "./http";
import {
  aiTaskKeyForFeature,
  type AITaskKey,
} from "./domain/ai-task-catalog";
import {
  buildAnalysisMessages,
  buildIssueAnalysisInput,
  buildPrAnalysisInput,
  validateDeepAnalysisMarkdown,
  validateIssueSummaryOutput,
  validatePrSummaryOutput,
} from "./domain/analysis-quality";
import {
  executeResolvedAITask,
  type ManagedAIResult,
} from "./services/ai-execution";
import { resolveAITask } from "./services/ai-task-settings";
import type { ResolvedPrompt } from "./services/prompt-resolution";

export type AIResult = ManagedAIResult;

export interface PromptedAIResult extends AIResult {
  prompt: ResolvedPrompt;
}

export async function generateAnalysisDocument(
  env: WorkerEnv,
  input: {
    userId: string;
    type: string;
    scope: string;
    evidence: string;
    fallback: string;
    taskKey?: AITaskKey;
  },
): Promise<PromptedAIResult> {
  const featureKey = input.type === "daily" ? "daily_report" : "cross_repo_insight";
  const task = await resolveAITask(
    env,
    input.userId,
    input.taskKey || aiTaskKeyForFeature(featureKey, input.scope),
  );
  const prompt = task.prompt;
  const user = `分析类型：${input.type}
分析范围：${input.scope}

当前启用的分析要求（${prompt.name} · r${prompt.revision}）：
${prompt.instruction}

可用证据：
${input.evidence.slice(0, 80_000)}`;
  const result = await executeResolvedAITask(env, {
    userId: input.userId,
    task,
    messages: [
      { role: "system", content: prompt.systemContract },
      { role: "user", content: user },
    ],
    fallback: input.fallback,
  });
  return { ...result, prompt };
}

export async function generateDomainMapDocument(
  env: WorkerEnv,
  input: {
    userId: string;
    domain: string;
    date: string;
    evidence: string;
    fallback: string;
  },
): Promise<PromptedAIResult> {
  const task = await resolveAITask(env, input.userId, "domain_architecture_map");
  const prompt = task.prompt;
  const user = `技术领域：${input.domain}
变化日期：北京时间 ${input.date}

当前启用的领域地图要求（${prompt.name} · r${prompt.revision}）：
${prompt.instruction}

可用架构基线与当日证据：
${input.evidence.slice(0, 80_000)}`;
  const result = await executeResolvedAITask(env, {
    userId: input.userId,
    task,
    messages: [
      { role: "system", content: prompt.systemContract },
      { role: "user", content: user },
    ],
    fallback: input.fallback,
  });
  return { ...result, prompt };
}

export async function generateTechnicalDocument(
  env: WorkerEnv,
  input: {
    userId: string;
    title: string;
    category: string;
    summary: string;
    contentMd: string;
    tags: string[];
    sourceRefs: string[];
  },
): Promise<PromptedAIResult> {
  const task = await resolveAITask(
    env,
    input.userId,
    "technical_document_generation",
  );
  const prompt = task.prompt;
  const user = `文档标题：${input.title}
技术分类：${input.category}
标签：${input.tags.join("、") || "未填写"}

当前启用的文档要求（${prompt.name} · r${prompt.revision}）：
${prompt.instruction}

现有摘要：
${input.summary || "未填写"}

现有 Markdown 草稿：
${input.contentMd.slice(0, 60_000)}

明确来源：
${input.sourceRefs.map((source) => `- ${source}`).join("\n") || "- 暂无；必须将相关结论标记为待确认"}`;
  const result = await executeResolvedAITask(env, {
    userId: input.userId,
    task,
    messages: [
      { role: "system", content: prompt.systemContract },
      { role: "user", content: user },
    ],
    fallback: input.contentMd,
  });
  return { ...result, prompt };
}

export async function analyzeCommunityItem(
  env: WorkerEnv,
  input: {
    userId: string;
    repo: string;
    kind: "pr" | "issue";
    context:
      | ReturnType<typeof buildPrAnalysisInput>
      | ReturnType<typeof buildIssueAnalysisInput>;
    userRequirement?: string;
  },
): Promise<PromptedAIResult & { evidenceCompleteness: string }> {
  const featureKey = input.kind === "pr" ? "pr_deep_analysis" : "issue_deep_analysis";
  const task = await resolveAITask(
    env,
    input.userId,
    aiTaskKeyForFeature(featureKey, input.repo),
  );
  const prompt = task.prompt;
  const messages = buildAnalysisMessages({
    systemContract: prompt.systemContract,
    evidence: input.context,
    promptName: prompt.name,
    promptRevision: prompt.revision,
    promptInstruction: prompt.instruction,
    userRequirement: input.userRequirement,
  });
  let result = await executeResolvedAITask(env, {
    userId: input.userId, task, messages, fallback: "",
  });
  if (result.provider !== "api") {
    throw new HttpError(503, "当前账户没有可用的 AI 深度分析服务");
  }
  let validation = validateDeepAnalysisMarkdown(result.content, input.kind);
  if (!validation.ok) {
    result = await executeResolvedAITask(env, {
      userId: input.userId,
      task,
      messages: [
        ...messages,
        { role: "assistant", content: result.content },
        {
          role: "user",
          content: `上一次输出缺少固定章节：${validation.missing.join("、")}。请保留证据约束，重新输出完整 Markdown；只返回报告正文。`,
        },
      ],
      fallback: "",
    });
    validation = validateDeepAnalysisMarkdown(result.content, input.kind);
  }
  if (!validation.ok) {
    throw new HttpError(
      502,
      `AI 深度分析结构不完整：缺少 ${validation.missing.join("、") || "有效正文"}`,
    );
  }
  return {
    ...result,
    prompt,
    evidenceCompleteness: input.context.evidenceCompleteness,
  };
}

export async function summarizeCommunityItem(
  env: WorkerEnv,
  input: {
    userId: string;
    repo: string;
    kind: "pr" | "issue";
    context:
      | ReturnType<typeof buildPrAnalysisInput>
      | ReturnType<typeof buildIssueAnalysisInput>;
  },
) {
  const featureKey = input.kind === "pr" ? "pr_triage" : "issue_triage";
  const task = await resolveAITask(
    env,
    input.userId,
    aiTaskKeyForFeature(featureKey, input.repo),
  );
  const prompt = task.prompt;
  const messages = buildAnalysisMessages({
    systemContract: prompt.systemContract,
    evidence: input.context,
    promptName: prompt.name,
    promptRevision: prompt.revision,
    promptInstruction: prompt.instruction,
  });
  let result = await executeResolvedAITask(env, {
    userId: input.userId, task, messages, fallback: "",
  });
  if (result.provider !== "api") {
    throw new HttpError(503, "当前账户没有可用的 AI 摘要服务");
  }
  const validate = (content: string) => input.kind === "pr"
    ? validatePrSummaryOutput(
        content,
        input.context as ReturnType<typeof buildPrAnalysisInput>,
      )
    : validateIssueSummaryOutput(content);
  let validation = validate(result.content);
  if (!validation.ok) {
    result = await executeResolvedAITask(env, {
      userId: input.userId,
      task,
      messages: [
        ...messages,
        { role: "assistant", content: result.content },
        {
          role: "user",
          content: `上一次输出未通过结构校验：${validation.error}。请严格按系统 JSON Schema 重新输出；只返回一个 JSON 对象。`,
        },
      ],
      fallback: "",
    });
    validation = validate(result.content);
  }
  if (!validation.ok) {
    throw new HttpError(502, `AI 摘要结构校验失败：${validation.error}`);
  }
  return {
    ...result,
    prompt,
    structured: validation.value,
    summary: validation.value.summary,
    evidenceCompleteness:
      "evidenceCompleteness" in validation.value
        ? validation.value.evidenceCompleteness
        : input.context.evidenceCompleteness,
  };
}

export async function answerChat(
  env: WorkerEnv,
  input: {
    userId: string;
    messages: AIMessage[];
    pageContext: string;
    selection: string;
    taskKey?: "chat_assistant" | "repository_code_chat";
  },
) {
  const task = await resolveAITask(
    env,
    input.userId,
    input.taskKey || "chat_assistant",
  );
  const prompt = task.prompt;
  const context = `当前页面上下文：
${input.pageContext.slice(0, 12_000) || "未提供"}

用户选中的文本：
${input.selection.slice(0, 8_000) || "未选择"}`;
  const fallback = `我已经收到问题，但当前账户尚未配置可用的 AI。

你可以在“设置 → AI 管理”中为“普通对话”选择 API 配置或本地 Agent，并切换对应提示词。选中的页面内容已经随请求传给服务端，配置完成后即可基于这段上下文回答。`;
  const result = await executeResolvedAITask(env, {
    userId: input.userId,
    task,
    messages: [
      { role: "system", content: prompt.systemContract },
      {
        role: "system",
        content: `当前启用的助手要求（${prompt.name} · r${prompt.revision}）：\n${prompt.instruction}`,
      },
      { role: "system", content: context },
      ...input.messages.slice(-20),
    ],
    fallback,
  });
  return { ...result, prompt };
}
