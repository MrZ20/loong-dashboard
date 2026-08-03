import { defineDomain } from "../../define";

export const coreScheduler = defineDomain({
  id: "core-scheduler-kv-cache", name: "Core Scheduler & KV Cache",
  description: "Ascend Core patch、Scheduler、Block/KV Cache 管理、prefix caching 与请求状态。",
  sourcePaths: ["vllm_ascend/core/", "vllm_ascend/patch/core/", "vllm_ascend/simple_kv_offload/"],
  testPaths: ["tests/unit_tests/core/", "tests/e2e/singlecard/prefix_caching/", "tests/e2e/singlecard/chunked_prefill/"],
  codeownerPaths: ["vllm_ascend/core/"], titleTerms: ["scheduler", "kv cache", "prefix caching", "block table", "chunked prefill"],
  bodyTerms: ["scheduler output", "cache manager", "request state", "block pool", "preemption"],
  labelTerms: ["module:core", "core-features", "async-scheduler", "kv-cache-pool"],
  excludePaths: ["vllm_ascend/kv_offload/", "vllm_ascend/distributed/kv_transfer/"],
  competingDomains: ["Worker & Graph", "KV Offload", "Distributed & KV Transfer", "Attention"], priority: 102,
  conflictResolution: "调度/缓存分配优先；外部介质 offload 归 KV Offload，跨节点传输归 Distributed。",
  examples: ["修改 Ascend scheduler patch", "实现 prefix cache block 管理"],
  e2eCoverageTerms: ["prefix_caching", "chunked_prefill", "kv-cache-pool"],
});
