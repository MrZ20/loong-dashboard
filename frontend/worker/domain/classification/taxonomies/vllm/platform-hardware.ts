import { defineDomain } from "../../define";

export const platformHardware = defineDomain({
  id: "platform-hardware",
  name: "Platform & Hardware",
  description: "CUDA/ROCm/CPU/XPU/TPU 平台抽象、设备能力和硬件专属实现。",
  sourcePaths: ["vllm/platforms/", "vllm/device_allocator/", "vllm/_custom_ops.py"],
  testPaths: ["tests/platforms/", "tests/cpu/", "tests/rocm/", "tests/tpu/", "tests/xpu/"],
  codeownerPaths: ["vllm/platforms/"],
  titleTerms: ["rocm", "cuda", "cpu backend", "xpu", "tpu", "platform"],
  bodyTerms: ["device capability", "hardware backend", "platform plugin", "device allocator"],
  labelTerms: ["rocm", "cpu", "intel-gpu", "tpu", "nvidia"],
  excludePaths: ["csrc/", "vllm/kernels/"],
  competingDomains: ["Compilation & Kernels", "Engine & Model Runner"],
  priority: 86,
  conflictResolution: "平台探测/设备抽象优先；通用 kernel 实现归 Compilation & Kernels。",
  examples: ["修改 ROCm platform capability", "新增 CPU device allocator 行为"],
});
