import { defineDomain } from "../../define";

export const compilation = defineDomain({
  id: "compilation", name: "Compilation",
  description: "Ascend torch.compile、图优化、fusion pass、编译缓存与算子融合。",
  sourcePaths: ["vllm_ascend/compilation/"], testPaths: ["tests/unit_tests/compilation/", "tests/e2e/singlecard/compile/"],
  codeownerPaths: ["vllm_ascend/compilation/"], titleTerms: ["compile", "torch.compile", "fusion", "inductor"],
  bodyTerms: ["graph pass", "compile cache", "fusion pass", "dynamo"], labelTerms: ["module:graph"],
  excludePaths: ["vllm_ascend/worker/"], competingDomains: ["Worker & Graph", "FusedMoE & Custom Ops"], priority: 100,
  conflictResolution: "编译 pass/fusion 机制优先；仅 ACLGraph 运行生命周期归 Worker & Graph。",
  examples: ["新增 Ascend compile fusion pass", "修复 compile cache key"],
  e2eCoverageTerms: ["compile_fusion", "aclgraph"],
});
