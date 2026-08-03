import { defineDomain } from "../../define";

export const samplingOutput = defineDomain({
  id: "sampling-output",
  name: "Sampling & Structured Output",
  description: "Sampling、structured output、reasoning/tool parsers、renderers 与 tokenization 输出链。",
  sourcePaths: ["vllm/v1/sample/", "vllm/v1/structured_output/", "vllm/reasoning/", "vllm/tool_parsers/", "vllm/renderers/", "vllm/sampling_params.py"],
  testPaths: ["tests/v1/sample/", "tests/v1/structured_output/", "tests/reasoning/", "tests/tool_use/", "tests/samplers/"],
  codeownerPaths: ["vllm/v1/sample/", "vllm/v1/structured_output/", "vllm/reasoning/", "vllm/tool_parsers/"],
  titleTerms: ["sampler", "sampling", "structured output", "reasoning parser", "tool parser"],
  bodyTerms: ["logits processor", "gumbel", "grammar", "guided decoding", "tool call"],
  labelTerms: ["structured-output", "tool-calling"],
  excludePaths: ["vllm/v1/spec_decode/"],
  competingDomains: ["Serving & APIs", "Speculative Decoding", "Engine & Model Runner"],
  priority: 99,
  conflictResolution: "通用采样、约束输出或 parser 源码优先；spec decode 专用 sampler 归 Speculative Decoding。",
  examples: ["修改 V1 Gumbel sampling", "修复 reasoning parser 工具调用泄漏"],
});
