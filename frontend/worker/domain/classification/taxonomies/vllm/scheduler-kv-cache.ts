import { defineDomain } from "../../define";

export const schedulerKvCache = defineDomain({
  id: "scheduler-kv-cache",
  name: "Scheduler & KV Cache",
  description: "V1 调度、请求生命周期、Block/Cache 管理、抢占与 prefix caching。",
  sourcePaths: ["vllm/v1/core/", "vllm/core/", "vllm/config/cache.py", "vllm/v1/kv_cache_interface.py"],
  testPaths: ["tests/v1/core/", "tests/core/", "tests/v1/test_prefix_caching", "tests/v1/test_kv_cache"],
  codeownerPaths: ["vllm/v1/core/", "vllm/config/cache.py"],
  titleTerms: ["scheduler", "scheduling", "kv cache", "prefix caching", "preemption", "block table"],
  bodyTerms: ["request queue", "kv cache manager", "block pool", "cache allocation", "scheduler output"],
  labelTerms: ["scheduler", "kv-cache", "v1"],
  excludePaths: ["vllm/distributed/kv_transfer/", "vllm/v1/kv_offload/"],
  competingDomains: ["Attention", "Distributed & KV Transfer", "Engine & Model Runner", "Speculative Decoding"],
  priority: 100,
  conflictResolution: "请求调度、块分配和缓存生命周期优先；KV 跨进程/节点传输归 Distributed。",
  examples: ["修改 v1/core/scheduler.py", "调整 KV cache manager 的 block 回收"],
});
