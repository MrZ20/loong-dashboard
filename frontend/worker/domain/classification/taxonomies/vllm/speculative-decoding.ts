import { defineDomain } from "../../define";

export const speculativeDecoding = defineDomain({
  id: "speculative-decoding",
  name: "Speculative Decoding",
  description: "Draft/Target 协同、proposal、rejection sampling、MTP/EAGLE 与 speculative config。",
  sourcePaths: ["vllm/v1/spec_decode/", "vllm/spec_decode/", "vllm/config/speculative.py"],
  testPaths: ["tests/v1/spec_decode/", "tests/spec_decode/"],
  codeownerPaths: ["vllm/v1/spec_decode/"],
  titleTerms: ["spec decode", "speculative decoding", "mtp", "eagle", "rejection sampler"],
  bodyTerms: ["draft model", "proposal", "acceptance", "rejection sampling", "speculative config"],
  labelTerms: ["speculative-decoding"],
  excludePaths: ["docs/"],
  competingDomains: ["Sampling & Structured Output", "Scheduler & KV Cache", "Model Support & Weight Loading"],
  priority: 104,
  conflictResolution: "Speculative pipeline 或 sampler 专属逻辑优先；通用 sampling 归 Sampling。",
  examples: ["修改 batch-sharded rejection sampler", "新增 MTP proposer 流程"],
});
