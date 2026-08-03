import { defineDomain } from "../../define";

export const sampling = defineDomain({
  id: "sampling", name: "Sampling",
  description: "Ascend sampling、logits 处理、guided decoding 与输出选择。",
  sourcePaths: ["vllm_ascend/sample/"], testPaths: ["tests/unit_tests/sample/", "tests/e2e/singlecard/sampling/"],
  codeownerPaths: ["vllm_ascend/sample/"], titleTerms: ["sampling", "sampler", "guided decoding", "logprobs"],
  bodyTerms: ["logits processor", "top k", "top p", "sample output"], labelTerms: ["core-features"],
  excludePaths: ["vllm_ascend/spec_decode/"], competingDomains: ["Speculative Decoding", "Worker & Graph"], priority: 98,
  conflictResolution: "通用采样源码优先；MTP/EAGLE 专属采样归 Speculative Decoding。",
  examples: ["修改 Ascend sampler logits 处理", "新增 guided decoding 测试"], e2eCoverageTerms: ["guided_decoding", "logprobs"],
});
