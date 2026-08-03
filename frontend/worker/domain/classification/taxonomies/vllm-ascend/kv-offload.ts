import { defineDomain } from "../../define";

export const kvOffload = defineDomain({
  id: "kv-offload", name: "KV Offload",
  description: "KV Cache 的 CPU/外部介质 offload、连接器、缓存生命周期和数据搬运。",
  sourcePaths: ["vllm_ascend/kv_offload/", "vllm_ascend/simple_kv_offload/"],
  testPaths: ["tests/unit_tests/kv_offload/", "tests/e2e/singlecard/kv_offload/", "tests/e2e/singlecard/cpu_offloading/"],
  codeownerPaths: ["vllm_ascend/kv_offload/"], titleTerms: ["kv offload", "kv pool", "cpu offload"],
  bodyTerms: ["offload connector", "cpu cache", "kv cache pool", "swap cache"], labelTerms: ["kv-cache-pool"],
  excludePaths: ["vllm_ascend/distributed/kv_transfer/"], competingDomains: ["Core Scheduler & KV Cache", "Distributed & KV Transfer", "Device & Memory"], priority: 112,
  conflictResolution: "KV 的 offload 介质与搬运实现优先；通用 block 分配归 Core。",
  examples: ["新增 Ascend KV Pool offload backend", "修改 CPU KV cache swap"],
  e2eCoverageTerms: ["cpu_offloading", "cpu_weight_offload"],
});
