import type { WorkerEnv } from "./db";
import { HttpError } from "./http";

interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIResult {
  content: string;
  model: string;
  provider: "api" | "fallback";
}

function normalizeBaseUrl(value: string | undefined) {
  return (value || "https://api.openai.com/v1").replace(/\/+$/, "");
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
  messages: AIMessage[],
  fallback: string,
): Promise<AIResult> {
  const model = env.AI_MODEL || "gpt-5-mini";
  if (!env.AI_API_KEY) {
    return { content: fallback, model: "fallback", provider: "fallback" };
  }

  const mode = env.AI_API_MODE === "responses" ? "responses" : "chat_completions";
  const baseUrl = normalizeBaseUrl(env.AI_API_BASE_URL);
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

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.AI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new HttpError(502, `AI API 调用失败（${response.status}）`, detail);
  }

  const payload = await response.json<any>();
  const content =
    mode === "responses"
      ? extractResponsesText(payload)
      : payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new HttpError(502, "AI API 未返回可用内容");
  }

  return { content: content.trim(), model, provider: "api" };
}

export async function generateAnalysisDocument(
  env: WorkerEnv,
  input: {
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
    title: string;
    bodyMd: string;
    diffText: string;
    prompt: string;
    fallback: string;
  },
) {
  const system = `你是 vLLM 社区代码评审助手。基于标题、PR/Issue Markdown 正文和完整 unified diff 输出中文 Markdown 深度分析。
必须包含：改动目的、实现机制、代码路径、兼容性影响、潜在风险、测试缺口、建议动作。
如果证据不足，明确写“待确认”，不要编造未出现的文件或行为。`;
  return callAI(
    env,
    [
      { role: "system", content: system },
      {
        role: "user",
        content: `标题：${input.title}

补充要求：
${input.prompt}

正文：
${input.bodyMd.slice(0, 40_000)}

完整 Diff：
${input.diffText.slice(0, 120_000)}`,
      },
    ],
    input.fallback,
  );
}

export async function answerChat(
  env: WorkerEnv,
  input: {
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
  const fallback = `我已经收到问题，但当前环境尚未配置 AI API。

你可以在部署环境中设置 \`AI_API_KEY\`、\`AI_API_BASE_URL\` 和 \`AI_MODEL\`。选中的页面内容已经随请求传给服务端，配置完成后即可基于这段上下文回答。`;
  return callAI(
    env,
    [
      { role: "system", content: system },
      { role: "system", content: context },
      ...input.messages.slice(-20),
    ],
    fallback,
  );
}
