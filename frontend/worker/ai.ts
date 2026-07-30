import { decryptCredential } from "./credentials";
import { first, type WorkerEnv } from "./db";
import { HttpError } from "./http";

interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIResult {
  content: string;
  model: string;
  provider: "api" | "fallback";
  providerName: string;
}

function normalizeBaseUrl(value: string | undefined) {
  return (value || "https://api.openai.com/v1").replace(/\/+$/, "");
}

async function resolveAIProvider(env: WorkerEnv, userId: string) {
  const selected = await first<Record<string, any>>(
    env,
    `SELECT user_profiles.active_ai_provider_id, ai_providers.*
     FROM user_profiles
     LEFT JOIN ai_providers
       ON ai_providers.id = user_profiles.active_ai_provider_id
       AND ai_providers.user_id = user_profiles.user_id
     WHERE user_profiles.user_id = ?`,
    [userId],
  );
  if (
    selected?.active_ai_provider_id &&
    selected.active_ai_provider_id !== "environment" &&
    selected.id
  ) {
    return {
      name: selected.name as string,
      model: selected.model as string,
      mode:
        selected.api_mode === "responses"
          ? ("responses" as const)
          : ("chat_completions" as const),
      baseUrl: normalizeBaseUrl(selected.base_url),
      token: await decryptCredential(env, selected.encrypted_token),
      configured: true,
      source: "stored" as const,
    };
  }
  return {
    name: "环境变量 OpenAI-compatible",
    model: env.AI_MODEL || "gpt-5-mini",
    mode:
      env.AI_API_MODE === "responses"
        ? ("responses" as const)
        : ("chat_completions" as const),
    baseUrl: normalizeBaseUrl(env.AI_API_BASE_URL),
    token: env.AI_API_KEY || "",
    configured: Boolean(env.AI_API_KEY),
    source: "environment" as const,
  };
}

function extractResponsesText(payload: any) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

export async function callAI(
  env: WorkerEnv,
  userId: string,
  messages: AIMessage[],
  fallback: string,
): Promise<AIResult> {
  const selected = await resolveAIProvider(env, userId);
  if (!selected.configured) {
    return {
      content: fallback,
      model: "fallback",
      provider: "fallback",
      providerName: selected.name,
    };
  }

  const { model, mode, baseUrl } = selected;
  const endpoint =
    mode === "responses" ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
  const body =
    mode === "responses"
      ? {
          model,
          input: messages.map((message) => ({
            role: message.role,
            content: [{ type: "input_text", text: message.content }],
          })),
        }
      : {
          model,
          messages,
          temperature: 0.2,
        };

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (selected.token) headers.authorization = `Bearer ${selected.token}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new HttpError(502, `AI API 调用失败（${response.status}）`, detail);
  }

  const payload = (await response.json()) as any;
  const content =
    mode === "responses"
      ? extractResponsesText(payload)
      : payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new HttpError(502, "AI API 未返回可用内容");
  }

  return {
    content: content.trim(),
    model,
    provider: "api",
    providerName: selected.name,
  };
}

export async function generateAnalysisDocument(
  env: WorkerEnv,
  input: {
    userId: string;
    type: string;
    scope: string;
    prompt: string;
    evidence: string;
    fallback: string;
  },
) {
  const system = `你是 vLLM 与 vLLM-Ascend 社区分析助手。
输出必须是一份可独立阅读的中文 Markdown 文档，而不是卡片或 JSON。
所有判断都要区分事实、推断和待确认项，并引用输入中的 PR、Issue、路径或统计作为证据。
文档至少包含：执行摘要、重要变化、影响分析、风险与不确定性、建议动作、证据来源。
不要把 AI 推断自动标记为“已适配”或“不适用”。`;
  const user = `分析类型：${input.type}
分析范围：${input.scope}

用户提示词：
${input.prompt}

可用证据：
${input.evidence.slice(0, 80_000)}`;
  return callAI(
    env,
    input.userId,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    input.fallback,
  );
}

export async function analyzeCommunityItem(
  env: WorkerEnv,
  input: {
    userId: string;
    title: string;
    bodyMd: string;
    diffText: string;
    prompt: string;
    fallback: string;
  },
) {
  const system = `你是 vLLM 社区代码评审助手。基于标题、PR/Issue Markdown 正文，以及当前请求中提供的变更统计或 unified diff 输出中文 Markdown 深度分析。
必须包含：改动目的、实现机制、代码路径、兼容性影响、潜在风险、测试缺口、建议动作。
如果证据不足，明确写“待确认”，不要编造未出现的文件或行为。`;
  return callAI(
    env,
    input.userId,
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `标题：${input.title}

补充要求：
${input.prompt}

正文：
${input.bodyMd.slice(0, 40_000)}

可用代码变更证据：
${input.diffText.slice(0, 120_000)}`,
      },
    ],
    input.fallback,
  );
}

const SUMMARY_DOMAINS = new Set([
  "Model Runner",
  "FusedMoE",
  "Scheduler",
  "Attention",
  "CI / Infra",
  "Distributed",
  "Other",
]);

function extractJsonArray(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || content;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function summarizeCommunityBatch(
  env: WorkerEnv,
  input: {
    userId: string;
    language: "zh" | "en" | "bilingual";
    items: Array<{
      id: string;
      kind: "pr" | "issue";
      state: string;
      title: string;
      bodyMd: string;
    }>;
  },
) {
  if (!input.items.length) {
    return { summaries: [], provider: "fallback" as const, providerName: "" };
  }
  const languageInstruction =
    input.language === "en"
      ? "Write summary and reason in concise English."
      : input.language === "bilingual"
        ? "Write summary as concise Chinese followed by concise English."
        : "摘要和理由使用简洁中文。";
  const result = await callAI(
    env,
    input.userId,
    [
      {
        role: "system",
        content: `你是 vLLM 社区信息分流助手。只输出 JSON 数组，不要 Markdown。
每项必须包含 id、summary、domain、important、reason。
summary 用一到两句话说明条目具体在做什么以及可能影响什么，不要复述模板问题。
domain 只能是 Model Runner、FusedMoE、Scheduler、Attention、CI / Infra、Distributed、Other。
important 仅在回归、安全、破坏性兼容、关键架构、关键性能或明显影响 vLLM-Ascend Review 时为 true。
${languageInstruction}`,
      },
      {
        role: "user",
        content: JSON.stringify(
          input.items.map((item) => ({
            ...item,
            bodyMd: item.bodyMd.slice(0, 8_000),
          })),
        ),
      },
    ],
    "[]",
  );
  if (result.provider !== "api") {
    return {
      summaries: [],
      provider: result.provider,
      providerName: result.providerName,
    };
  }
  const requestedIds = new Set(input.items.map((item) => item.id));
  const summaries = extractJsonArray(result.content).flatMap((item: any) => {
    const id = typeof item?.id === "string" ? item.id : "";
    const summary = typeof item?.summary === "string" ? item.summary.trim() : "";
    const domain =
      typeof item?.domain === "string" && SUMMARY_DOMAINS.has(item.domain)
        ? item.domain
        : "Other";
    if (!requestedIds.has(id) || !summary) return [];
    return [{
      id,
      summary: summary.slice(0, 500),
      domain,
      important: item.important === true,
      reason:
        typeof item.reason === "string" ? item.reason.trim().slice(0, 300) : "",
    }];
  });
  return {
    summaries,
    provider: result.provider,
    providerName: result.providerName,
  };
}

export async function answerChat(
  env: WorkerEnv,
  input: {
    userId: string;
    messages: AIMessage[];
    pageContext: string;
    selection: string;
  },
) {
  const system = `你是 LoongBoard 内置社区助手，服务于 vLLM 与 vLLM-Ascend 维护者。
优先回答当前页面、选中文本、PR/Issue、技术领域、代码架构和社区协作相关问题。
使用中文 Markdown；引用上下文中的编号、路径或标题；缺少证据时说明需要同步或补充什么。`;
  const context = `当前页面上下文：
${input.pageContext.slice(0, 12_000) || "未提供"}

用户选中的文本：
${input.selection.slice(0, 8_000) || "未选择"}`;
  const fallback = `我已经收到问题，但当前账户尚未配置可用的 AI。

你可以在“设置 → AI 模型”中新增并切换 API 配置，或继续使用环境变量 OpenAI-compatible 调试方式。选中的页面内容已经随请求传给服务端，配置完成后即可基于这段上下文回答。`;
  return callAI(
    env,
    input.userId,
    [
      { role: "system", content: system },
      { role: "system", content: context },
      ...input.messages.slice(-20),
    ],
    fallback,
  );
}
