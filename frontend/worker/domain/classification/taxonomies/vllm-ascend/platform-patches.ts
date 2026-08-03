import { defineDomain } from "../../define";

export const platformPatches = defineDomain({
  id: "platform-patches", name: "Platform & Patches",
  description: "Ascend platform 注册、配置、上游兼容 patch 与版本适配边界。",
  sourcePaths: ["vllm_ascend/platform.py", "vllm_ascend/patch/", "vllm_ascend/config.py", "vllm_ascend/_310p/"],
  testPaths: ["tests/unit_tests/platform/", "tests/unit_tests/patch/", "tests/e2e/310p/"],
  codeownerPaths: ["vllm_ascend/patch/", "vllm_ascend/platform.py"], titleTerms: ["platform", "main2main", "compatibility", "310p", "a5"],
  bodyTerms: ["upstream compatibility", "monkey patch", "version gate", "npu platform"], labelTerms: ["main2main", "310p", "a5"],
  excludePaths: ["vllm_ascend/patch/worker/", "vllm_ascend/patch/distributed/"],
  competingDomains: ["Worker & Graph", "Distributed & KV Transfer", "Device & Memory"], priority: 75,
  conflictResolution: "跨领域平台注册/兼容层优先；具体模块 patch 映射回该模块技术域。",
  examples: ["修改 Ascend platform 注册", "增加上游版本兼容 gate"], e2eCoverageTerms: ["310p", "a2", "a3", "a5"],
});
