import { defineDomain } from "../../define";

export const workerGraph = defineDomain({
  id: "worker-graph", name: "Worker & Graph",
  description: "Ascend Worker、V1/V2 Model Runner、InputBatch、ACLGraph 捕获与执行生命周期。",
  sourcePaths: ["vllm_ascend/worker/", "vllm_ascend/graph/"],
  testPaths: ["tests/unit_tests/worker/", "tests/e2e/singlecard/graph/", "tests/e2e/multicard/worker/"],
  codeownerPaths: ["vllm_ascend/worker/"], titleTerms: ["worker", "model runner", "model_runner", "input batch", "aclgraph", "graph capture", "mrv2"],
  bodyTerms: ["npu model runner", "execute model", "dummy run", "graph mode", "sleep wake"],
  labelTerms: ["module:graph", "aclgraph", "main2main"], excludePaths: ["vllm_ascend/core/"],
  competingDomains: ["Core Scheduler & KV Cache", "Compilation", "Device & Memory"], priority: 106,
  conflictResolution: "Runner/Worker 或图执行生命周期优先；scheduler 状态机归 Core。",
  examples: ["修改 vllm_ascend/worker/model_runner.py", "调整 ACLGraph capture/replay"],
  e2eCoverageTerms: ["aclgraph", "sleep_wake", "graph_mode", "batch_invariant"],
});
