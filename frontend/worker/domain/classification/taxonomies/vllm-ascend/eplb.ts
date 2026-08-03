import { defineDomain } from "../../define";

export const eplb = defineDomain({
  id: "eplb", name: "EPLB",
  description: "专家放置与动态负载均衡、冗余专家、统计收集和重平衡策略。",
  sourcePaths: ["vllm_ascend/eplb/"], testPaths: ["tests/unit_tests/eplb/", "tests/e2e/multicard/eplb/"],
  codeownerPaths: ["vllm_ascend/eplb/"], titleTerms: ["eplb", "expert load balancing", "dynamic eplb"],
  bodyTerms: ["expert placement", "redundant expert", "rebalance", "expert load"],
  labelTerms: ["eplb"], excludePaths: [], competingDomains: ["FusedMoE & Custom Ops", "Distributed & KV Transfer"], priority: 115,
  conflictResolution: "专家放置/重平衡策略源码命中时优先于通用 MoE 或 EP 通信。",
  examples: ["修改 EPLB rebalance policy", "新增 dynamic EPLB E2E"],
  e2eCoverageTerms: ["eplb", "dynamic_eplb"],
});
