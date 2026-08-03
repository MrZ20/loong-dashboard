import { defineDomain } from "../../define";

export const speculativeDecoding = defineDomain({
  id: "speculative-decoding", name: "Speculative Decoding",
  description: "MTP/EAGLE proposer、speculative 执行、accept/reject 与相关 Worker 适配。",
  sourcePaths: ["vllm_ascend/spec_decode/"], testPaths: ["tests/unit_tests/spec_decode/", "tests/e2e/singlecard/spec_decode/"],
  codeownerPaths: ["vllm_ascend/spec_decode/"], titleTerms: ["spec decode", "speculative", "mtp", "eagle3"],
  bodyTerms: ["draft model", "proposer", "acceptance", "rejection sampler"], labelTerms: ["mtp/speculative-decode"],
  excludePaths: ["vllm_ascend/sample/"], competingDomains: ["Sampling", "Worker & Graph", "Model Loading & Weight Transfer"], priority: 110,
  conflictResolution: "Spec decode 专属 pipeline 优先；通用 sampler 归 Sampling。",
  examples: ["修改 MTP proposer", "新增 EAGLE3 speculative E2E"], e2eCoverageTerms: ["spec_decode", "mtp", "eagle3"],
});
