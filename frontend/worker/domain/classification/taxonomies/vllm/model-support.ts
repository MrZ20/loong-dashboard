import { defineDomain } from "../../define";

export const modelSupport = defineDomain({
  id: "model-support-loading",
  name: "Model Support & Weight Loading",
  description: "模型架构实现、注册、配置、权重装载与映射。",
  sourcePaths: ["vllm/model_executor/models/", "vllm/model_executor/model_loader/", "vllm/transformers_utils/configs/", "vllm/model_executor/layers/loader.py"],
  testPaths: ["tests/models/", "tests/model_executor/model_loader/", "tests/weight_loading/"],
  codeownerPaths: ["vllm/model_executor/model_loader/", "vllm/model_executor/models/"],
  titleTerms: ["model support", "support model", "weight loading", "weight loader", "checkpoint"],
  bodyTerms: ["model registry", "load weights", "hf config", "new architecture", "model implementation"],
  labelTerms: ["model-bash", "model"],
  excludePaths: ["vllm/model_executor/layers/attention/", "vllm/model_executor/layers/fused_moe/"],
  competingDomains: ["Multimodal", "Quantization", "FusedMoE & Expert Parallelism"],
  priority: 88,
  conflictResolution: "新增/修改模型主体和权重映射优先；通用层实现由 Attention/MoE/Quantization 覆盖。",
  examples: ["新增模型 architecture 文件和 registry", "修复 safetensors 权重映射"],
});
