import { defineDomain } from "../../define";

export const distributedKvTransfer = defineDomain({
  id: "distributed-kv-transfer", name: "Distributed & KV Transfer",
  description: "HCCL 并行、KV Transfer/Connector、PD/EPD 解耦、权重广播与跨实例通信。",
  sourcePaths: ["vllm_ascend/distributed/", "vllm_ascend/patch/distributed/"],
  testPaths: ["tests/unit_tests/distributed/", "tests/e2e/multicard/distributed/", "tests/e2e/pd/"],
  codeownerPaths: ["vllm_ascend/distributed/"], titleTerms: ["distributed", "kv transfer", "kv connector", "pd disaggregation", "tensor parallel", "flashcomm"],
  bodyTerms: ["hccl", "collective", "prefill decode", "weight transfer", "multi instance", "parallel state"],
  labelTerms: ["module:dp", "module:ep", "pd-disaggregation", "flashcomm"], excludePaths: ["vllm_ascend/eplb/"],
  competingDomains: ["EPLB", "FusedMoE & Custom Ops", "KV Offload", "Model Loading & Weight Transfer"], priority: 105,
  conflictResolution: "跨进程/节点通信与 KV connector 优先；EPLB 算法归 EPLB，加载阶段权重映射归 Model Loading。",
  examples: ["修改 SFA PD KV Transfer", "新增 FlashComm 并行通信路径"],
  e2eCoverageTerms: ["pd_mix", "pd_disaggregation", "epd", "tp", "pp", "dp", "dcp", "sp", "flashcomm1", "multi_instance"],
});
