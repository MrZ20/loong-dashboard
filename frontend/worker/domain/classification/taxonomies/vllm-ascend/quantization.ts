import { defineDomain } from "../../define";

export const quantization = defineDomain({
  id: "quantization", name: "Quantization",
  description: "Ascend 量化方法、低精度参数、W8A8/FP8/INT4 与量化算子适配。",
  sourcePaths: ["vllm_ascend/quantization/"], testPaths: ["tests/unit_tests/quantization/", "tests/e2e/singlecard/quantization/"],
  codeownerPaths: ["vllm_ascend/quantization/"], titleTerms: ["quantization", "w8a8", "fp8", "int8", "int4", "quantized"],
  bodyTerms: ["quant method", "weight quant", "activation quant", "anti outlier"], labelTerms: ["module:quantization"],
  excludePaths: ["docs/"], competingDomains: ["FusedMoE & Custom Ops", "Model Loading & Weight Transfer"], priority: 108,
  conflictResolution: "量化方法/参数核心修改优先；仅量化模型权重映射仍归 Model Loading。",
  examples: ["新增 W8A8 quant method", "修复 MoE FP8 参数处理"],
  e2eCoverageTerms: ["quantization"],
});
