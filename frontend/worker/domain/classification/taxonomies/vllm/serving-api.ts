import { defineDomain } from "../../define";

export const servingApi = defineDomain({
  id: "serving-api",
  name: "Serving & APIs",
  description: "OpenAI/Anthropic/Pooling/Speech API、CLI、请求协议与服务生命周期。",
  sourcePaths: ["vllm/entrypoints/", "vllm/serve/", "vllm/usage/"],
  testPaths: ["tests/entrypoints/", "tests/serve/", "tests/tool_use/"],
  codeownerPaths: ["vllm/entrypoints/openai/", "vllm/entrypoints/serve/", "vllm/entrypoints/cli/"],
  titleTerms: ["api server", "openai api", "serving", "chat completion", "cli"],
  bodyTerms: ["request protocol", "response schema", "server startup", "http endpoint", "online serving"],
  labelTerms: ["frontend", "tool-calling"],
  excludePaths: ["vllm/reasoning/", "vllm/tool_parsers/"],
  competingDomains: ["Sampling & Structured Output", "Multimodal", "Engine & Model Runner"],
  priority: 92,
  conflictResolution: "接口协议/服务入口为主时优先；parser 或 structured output 核心归 Sampling & Structured Output。",
  examples: ["修改 OpenAI chat completion protocol", "新增 serve CLI 子命令"],
});
