import { defineDomain } from "../../define";

export const quantization = defineDomain({
  id: "quantization",
  name: "Quantization",
  description: "量化配置、量化方法、低精度权重与算子适配。",
  sourcePaths: ["vllm/model_executor/layers/quantization/", "vllm/model_executor/parameter.py"],
  testPaths: ["tests/quantization/", "tests/models/quantization/"],
  codeownerPaths: ["vllm/model_executor/layers/quantization/"],
  titleTerms: ["quantization", "quantized", "gptq", "awq", "fp8", "nvfp4", "int8"],
  bodyTerms: ["w8a8", "weight only", "compressed tensors", "marlin", "bitsandbytes"],
  labelTerms: ["quantization"],
  excludePaths: ["docs/"],
  competingDomains: ["Model Support & Weight Loading", "Compilation & Kernels"],
  priority: 100,
  conflictResolution: "量化方法/参数核心修改优先；仅新模型注册或普通权重加载归 Model Support。",
  examples: ["新增 NVFP4 quant method", "修复 FP8 权重量化参数"],
});
