import { defineDomain } from "../../define";

export const deviceMemory = defineDomain({
  id: "device-memory", name: "Device & Memory",
  description: "NPU device abstraction、allocator、内存池、profiling 与资源生命周期。",
  sourcePaths: ["vllm_ascend/device/", "vllm_ascend/device_allocator/", "vllm_ascend/profiler/"],
  testPaths: ["tests/unit_tests/device/", "tests/unit_tests/device_allocator/", "tests/e2e/singlecard/profiling/"],
  codeownerPaths: ["vllm_ascend/device/", "vllm_ascend/device_allocator/"], titleTerms: ["device", "allocator", "memory", "profiling", "npu memory"],
  bodyTerms: ["memory pool", "device context", "oom", "profiler", "allocation"], labelTerms: ["cpu-binding"],
  excludePaths: ["vllm_ascend/kv_offload/"], competingDomains: ["KV Offload", "Worker & Graph", "Platform & Patches"], priority: 96,
  conflictResolution: "设备/内存基础设施优先；KV 专属 offload 归 KV Offload。", examples: ["修改 NPU allocator", "新增 device memory profiling"],
  e2eCoverageTerms: ["profiling", "sleep_wake"],
});
