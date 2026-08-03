import { defineDomain } from "../../define";

export const distributedKvTransfer = defineDomain({
  id: "distributed-kv-transfer",
  name: "Distributed & KV Transfer",
  description: "并行状态、collective、KV Connector、PD 解耦、弹性并行与权重传输。",
  sourcePaths: ["vllm/distributed/", "vllm/v1/executor/", "vllm/executor/"],
  testPaths: ["tests/distributed/", "tests/v1/distributed/", "tests/v1/kv_connector/", "tests/entrypoints/openai/disaggregated/"],
  codeownerPaths: ["vllm/distributed/kv_transfer/", "vllm/distributed/", "vllm/v1/executor/"],
  titleTerms: ["distributed", "kv connector", "kv transfer", "disaggregated", "tensor parallel", "pipeline parallel"],
  bodyTerms: ["collective rpc", "all reduce", "parallel state", "mooncake", "nixl", "prefill decode"],
  labelTerms: ["kv-connector", "ray", "distributed"],
  excludePaths: ["vllm/model_executor/layers/fused_moe/"],
  competingDomains: ["FusedMoE & Expert Parallelism", "Scheduler & KV Cache", "Engine & Model Runner"],
  priority: 100,
  conflictResolution: "通用通信、KV/权重跨进程传输优先；专家专属路由归 FusedMoE。",
  examples: ["新增 Mooncake KV Connector", "修改多进程 executor collective RPC"],
});
