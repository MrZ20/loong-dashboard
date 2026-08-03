import { defineDomain } from "../../define";

export const fusedMoeOps = defineDomain({
  id: "fused-moe-ops", name: "FusedMoE & Custom Ops",
  description: "Ascend MoE、专家路由、MC2/All-to-All、融合算子与通用 NPU custom op。",
  sourcePaths: ["vllm_ascend/ops/fused_moe/", "vllm_ascend/ops/", "csrc/moe/", "csrc/mc2/", "csrc/gmm/"],
  testPaths: ["tests/unit_tests/ops/fused_moe/", "tests/unit_tests/ops/", "tests/e2e/multicard/moe/"],
  codeownerPaths: ["vllm_ascend/ops/"], titleTerms: ["fused moe", "fused_moe", "moe", "custom op", "mc2", "grouped matmul"],
  bodyTerms: ["shared expert", "router logits", "all-to-all", "multistream moe", "moe offload"],
  labelTerms: ["module:ops", "custom-op", "module:ep"], excludePaths: ["vllm_ascend/attention/"],
  competingDomains: ["EPLB", "Distributed & KV Transfer", "Compilation"], priority: 110,
  conflictResolution: "MoE 层/融合算子修改优先；负载均衡策略归 EPLB，通用通信归 Distributed。",
  examples: ["修改 Ascend FusedMoE 路由与 grouped matmul", "新增 MC2 custom op"],
  e2eCoverageTerms: ["multistream_moe", "mo_routing_replay", "moe", "ep"],
});
