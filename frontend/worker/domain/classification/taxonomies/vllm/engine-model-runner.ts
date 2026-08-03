import { defineDomain } from "../../define";

export const engineModelRunner = defineDomain({
  id: "engine-model-runner",
  name: "Engine & Model Runner",
  description: "Engine 编排、Worker、GPU Model Runner、输入批处理与模型执行生命周期。",
  sourcePaths: ["vllm/v1/engine/", "vllm/v1/worker/", "vllm/worker/", "vllm/engine/", "vllm/v1/executor/abstract.py"],
  testPaths: ["tests/v1/engine/", "tests/v1/worker/", "tests/worker/", "tests/engine/", "tests/v1/test_model_runner"],
  codeownerPaths: ["vllm/v1/worker/gpu/", "vllm/v1/worker/", "vllm/v1/engine/", "vllm/engine/"],
  titleTerms: ["model runner", "model_runner", "engine", "worker", "input batch", "mrv2"],
  bodyTerms: ["gpu model runner", "execute model", "input batch", "worker lifecycle", "engine core client"],
  labelTerms: ["mrv2", "mrv1-only", "v1"],
  excludePaths: ["vllm/v1/core/", "vllm/v1/attention/"],
  competingDomains: ["Scheduler & KV Cache", "Attention", "Platform & Hardware"],
  priority: 98,
  conflictResolution: "Runner/Worker 执行编排为主时优先；调度策略归 Scheduler，模型实现归 Model Support。",
  examples: ["修改 v1/worker/gpu_model_runner", "调整 Engine 到 Worker 的执行生命周期"],
});
