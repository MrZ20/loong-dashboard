import { defineDomain } from "../../define";

export const attention = defineDomain({
  id: "attention", name: "Attention",
  description: "Ascend Attention backend、MLA/MHA、context parallel、FA/FIA 与 KV 压缩交互。",
  sourcePaths: ["vllm_ascend/attention/", "csrc/attention/"],
  testPaths: ["tests/unit_tests/attention/", "tests/e2e/singlecard/attention/", "tests/e2e/multicard/context_parallel/"],
  codeownerPaths: ["vllm_ascend/attention/"],
  titleTerms: ["attention", "mla", "fa3", "fia", "context parallel", "dsa"],
  bodyTerms: ["paged attention", "flash attention", "attention backend", "kvcomp", "context parallel"],
  labelTerms: ["module:attention", "attention", "flashcomm"], excludePaths: ["docs/"],
  competingDomains: ["Core Scheduler & KV Cache", "FusedMoE & Custom Ops", "Worker & Graph"], priority: 108,
  conflictResolution: "Attention backend/算子优先；仅缓存生命周期归 Core Scheduler & KV Cache。",
  examples: ["修改 attention backend 的 MLA 路径", "调整 context parallel attention 并补 E2E"],
  e2eCoverageTerms: ["fa3", "fia_comparison", "sfa_dsa", "dsa_cp", "long_sequence"],
});
