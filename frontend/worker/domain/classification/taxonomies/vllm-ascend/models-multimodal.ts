import { defineDomain } from "../../define";

export const modelsMultimodal = defineDomain({
  id: "models-multimodal", name: "Models & Multimodal",
  description: "Ascend 专属模型 patch、模型结构适配、多模态 processor 与架构兼容。",
  sourcePaths: ["vllm_ascend/models/", "vllm_ascend/patch/models/", "vllm_ascend/multimodal/"],
  testPaths: ["tests/unit_tests/models/", "tests/e2e/singlecard/models/", "tests/e2e/singlecard/multimodal/"],
  codeownerPaths: ["vllm_ascend/models/"], titleTerms: ["model support", "multimodal", "vision", "mamba", "reranker", "embedding"],
  bodyTerms: ["model architecture", "model registry", "multimodal", "processor", "model patch"], labelTerms: ["module:multimodal", "architecture-features"],
  excludePaths: ["vllm_ascend/model_loader/"], competingDomains: ["Model Loading & Weight Transfer", "Attention", "FusedMoE & Custom Ops"], priority: 92,
  conflictResolution: "模型结构/多模态处理为主时优先；加载机制归 Model Loading，通用层归对应技术域。",
  examples: ["适配 Ascend 多模态模型 processor", "修改 Mamba 模型 patch"],
  e2eCoverageTerms: ["dense", "moe", "embedding", "classification", "reranker", "mamba_ssm", "multimodal"],
});
