import { HttpError } from "../../http";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAICompatibleConfig {
  name: string;
  model: string;
  mode: "responses" | "chat_completions";
  baseUrl: string;
  token: string;
  configured: boolean;
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

export async function requestOpenAICompatible(
  config: OpenAICompatibleConfig,
  messages: AIMessage[],
) {
  const endpoint = config.mode === "responses"
    ? `${config.baseUrl}/responses`
    : `${config.baseUrl}/chat/completions`;
  const body = config.mode === "responses"
    ? {
        model: config.model,
        input: messages.map((message) => ({
          role: message.role,
          content: [{ type: "input_text", text: message.content }],
        })),
      }
    : { model: config.model, messages, temperature: 0.2 };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
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
  const content = config.mode === "responses"
    ? extractResponsesText(payload)
    : payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new HttpError(502, "AI API 未返回可用内容");
  }
  return content.trim();
}

