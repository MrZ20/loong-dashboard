import { defineDomain } from "../../define";

export const attention = defineDomain({
  id: "attention",
  name: "Attention",
  description: "Attention backend、MLA/MHA、KV Cache 读写及注意力算子交互。",
  sourcePaths: ["vllm/model_executor/layers/attention/", "vllm/v1/attention/", "vllm/attention/", "csrc/attention/"],
  testPaths: ["tests/kernels/attention/", "tests/v1/attention/", "tests/attention/", "tests/models/attention/"],
  codeownerPaths: ["vllm/model_executor/layers/attention/", "vllm/v1/attention/"],
  titleTerms: ["attention", "mla", "flash attention", "paged attention", "kv cache dtype"],
  bodyTerms: ["attention backend", "attention layer", "flashinfer", "flash-attn", "mha", "mla"],
  labelTerms: ["attention", "dflash"],
  excludePaths: ["docs/", ".buildkite/"],
  competingDomains: ["Scheduler & KV Cache", "Compilation & Kernels", "Model Support & Weight Loading"],
  priority: 100,
  conflictResolution: "Attention 层或 backend 源码优先；仅缓存管理与块分配归 Scheduler & KV Cache。",
  examples: ["修改 vllm/v1/attention/backends", "调整 MLA attention layer 并同步 attention tests"],
});
