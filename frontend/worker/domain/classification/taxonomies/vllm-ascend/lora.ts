import { defineDomain } from "../../define";

export const lora = defineDomain({
  id: "lora", name: "LoRA",
  description: "Ascend LoRA adapter、融合算子、动态加载和多 LoRA 运行时。",
  sourcePaths: ["vllm_ascend/lora/"], testPaths: ["tests/unit_tests/lora/", "tests/e2e/singlecard/lora/"],
  codeownerPaths: ["vllm_ascend/lora/"], titleTerms: ["lora", "adapter"], bodyTerms: ["multi lora", "runtime lora", "fully sharded lora"],
  labelTerms: ["module:lora"], excludePaths: [], competingDomains: ["Model Loading & Weight Transfer", "FusedMoE & Custom Ops"], priority: 106,
  conflictResolution: "LoRA adapter 生命周期或算子优先。", examples: ["修改 runtime LoRA manager", "新增 fully sharded LoRA E2E"],
  e2eCoverageTerms: ["lora", "multi_lora", "runtime_lora", "fully_sharded_lora"],
});
