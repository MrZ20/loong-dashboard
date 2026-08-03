import { defineDomain } from "../../define";

export const compilationKernels = defineDomain({
  id: "compilation-kernels",
  name: "Compilation & Kernels",
  description: "torch.compile、vLLM IR、图优化、Triton/CUDA kernels 与自定义算子。",
  sourcePaths: ["vllm/compilation/", "vllm/ir/", "vllm/kernels/", "vllm/model_executor/custom_op.py", "csrc/"],
  testPaths: ["tests/compile/", "tests/kernels/", "tests/ir/", "tests/model_executor/test_custom_op"],
  codeownerPaths: ["vllm/compilation/", "vllm/ir/", "vllm/kernels/"],
  titleTerms: ["compile", "torch.compile", "kernel", "triton", "cuda graph", "vllm ir"],
  bodyTerms: ["inductor", "custom op", "kernel launch", "graph capture", "fusion pass"],
  labelTerms: ["torch.compile", "vllm-ir", "cuda"],
  excludePaths: ["tests/kernels/attention/", "tests/kernels/moe/"],
  competingDomains: ["Attention", "FusedMoE & Expert Parallelism", "Platform & Hardware"],
  priority: 94,
  conflictResolution: "通用编译/内核基础设施优先；特定 Attention/MoE 核心实现仍归对应领域。",
  examples: ["修改 vllm/compilation passes", "新增通用 Triton kernel 与 kernel tests"],
});
