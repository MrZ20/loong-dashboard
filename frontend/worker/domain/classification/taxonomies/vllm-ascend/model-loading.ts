import { defineDomain } from "../../define";

export const modelLoading = defineDomain({
  id: "model-loading-weight-transfer", name: "Model Loading & Weight Transfer",
  description: "模型加载、NetLoader/RFork、权重映射、在线权重更新与传输。",
  sourcePaths: ["vllm_ascend/model_loader/", "vllm_ascend/model_executor/offloader/", "vllm_ascend/distributed/weight_transfer/"],
  testPaths: ["tests/unit_tests/model_loader/", "tests/unit_tests/model_executor/", "tests/e2e/singlecard/weight_transfer/"],
  codeownerPaths: ["vllm_ascend/model_loader/"], titleTerms: ["model loader", "weight loading", "weight transfer", "rfork", "netloader"],
  bodyTerms: ["load weights", "online weight update", "checkpoint", "weight mapping"], labelTerms: ["module:rl"],
  excludePaths: ["vllm_ascend/quantization/"], competingDomains: ["Models & Multimodal", "Distributed & KV Transfer", "Quantization"], priority: 101,
  conflictResolution: "加载/权重生命周期为主时优先；通用通信归 Distributed，模型结构归 Models。",
  examples: ["修改 NetLoader 权重映射", "实现在线 weight transfer"], e2eCoverageTerms: ["weight_transfer", "cpu_weight_offload"],
});
