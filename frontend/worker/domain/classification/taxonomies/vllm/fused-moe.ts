import { defineDomain } from "../../define";

export const fusedMoe = defineDomain({
  id: "fused-moe",
  name: "FusedMoE & Expert Parallelism",
  description: "MoE 层、路由、专家并行、all-to-all 与融合专家算子。",
  sourcePaths: ["vllm/model_executor/layers/fused_moe/", "vllm/distributed/device_communicators/", "csrc/moe/"],
  testPaths: ["tests/kernels/moe/", "tests/ops/fused_moe/", "tests/models/moe/", "tests/distributed/test_ep", "tests/model_executor/test_fused_moe"],
  codeownerPaths: ["vllm/model_executor/layers/fused_moe/"],
  titleTerms: ["fused moe", "fused_moe", "expert parallel", "elastic ep", "moe"],
  bodyTerms: ["expert routing", "all-to-all", "grouped matmul", "router logits", "shared expert"],
  labelTerms: ["expert-parallelism", "moe", "deepseek"],
  excludePaths: ["docs/", ".buildkite/"],
  competingDomains: ["Distributed & KV Transfer", "Compilation & Kernels", "Model Support & Weight Loading"],
  priority: 105,
  conflictResolution: "专家路由/MoE 层为主时优先；通用 collective 或 KV 传输归 Distributed。",
  examples: ["修改 fused_moe layer 的专家选择", "实现 Elastic EP 控制路径"],
});
