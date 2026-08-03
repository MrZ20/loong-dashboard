import { defineDomain } from "../../define";

export const lora = defineDomain({
  id: "lora",
  name: "LoRA",
  description: "LoRA adapter 装载、激活、运行时管理与融合层。",
  sourcePaths: ["vllm/lora/"],
  testPaths: ["tests/lora/", "tests/entrypoints/openai/test_lora"],
  codeownerPaths: ["vllm/lora/"],
  titleTerms: ["lora", "adapter"],
  bodyTerms: ["lora request", "adapter weights", "multi lora", "punica"],
  labelTerms: ["lora"],
  excludePaths: ["docs/"],
  competingDomains: ["Model Support & Weight Loading", "Engine & Model Runner"],
  priority: 101,
  conflictResolution: "Adapter 生命周期或 LoRA 层为主时优先。",
  examples: ["修改 LoRAModelManager", "新增 runtime LoRA adapter 测试"],
});
