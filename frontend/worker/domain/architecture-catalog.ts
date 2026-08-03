import { getRepositoryTaxonomy } from "./classification/registry";
import type { RepositoryTaxonomyId } from "./classification/types";

export type DomainArchitecture = {
  description: string;
  pipeline: string;
  upstreamPaths: string[];
  ascendPaths: string[];
  testPaths: string[];
  symbols: string[];
  taxonomyDomainIds: Record<RepositoryTaxonomyId, string[]>;
  legacyDomainNames?: string[];
};

export type DomainArchitectureEntry = {
  name: string;
  architecture: DomainArchitecture;
};

function taxonomyDomainNames(
  architecture: DomainArchitecture,
  repoId: RepositoryTaxonomyId,
) {
  const taxonomy = getRepositoryTaxonomy(repoId);
  const names = new Map(taxonomy.domains.map((domain) => [domain.id, domain.name]));
  return architecture.taxonomyDomainIds[repoId].flatMap((id) => {
    const name = names.get(id);
    return name ? [name] : [];
  });
}

export function architectureTaxonomyDomains(architecture: DomainArchitecture) {
  return {
    vllm: taxonomyDomainNames(architecture, "vllm"),
    "vllm-ascend": taxonomyDomainNames(architecture, "vllm-ascend"),
  };
}

export function architectureMatchesDomain(
  architecture: DomainArchitecture,
  repoId: string,
  domain: string,
) {
  if (repoId !== "vllm" && repoId !== "vllm-ascend") return false;
  return taxonomyDomainNames(architecture, repoId).includes(domain) ||
    (architecture.legacyDomainNames ?? []).includes(domain);
}

export function findArchitectureForDomain(
  repoId: string,
  domain: string,
): DomainArchitectureEntry | null {
  for (const [name, architecture] of Object.entries(DOMAIN_ARCHITECTURES)) {
    if (architectureMatchesDomain(architecture, repoId, domain)) {
      return { name, architecture };
    }
  }
  return null;
}

/** Maintained cross-repository architecture baselines used by the domain map. */
export const DOMAIN_ARCHITECTURES: Record<string, DomainArchitecture> = {
  FusedMoE: {
    description: "专家路由、融合算子与 Expert Parallel 通信的核心执行领域。",
    pipeline: "Model Execute → Router → Expert Dispatch → Expert Compute",
    upstreamPaths: ["vllm/model_executor/layers/fused_moe/"],
    ascendPaths: ["vllm_ascend/ops/fused_moe/", "vllm_ascend/distributed/"],
    testPaths: ["tests/ops/fused_moe/", "tests/unit_tests/ops/fused_moe/", "tests/e2e/multicard/eplb/"],
    symbols: ["FusedMoE", "FusedMoEMethodBase", "AscendFusedMoE", "ExpertParallel"],
    taxonomyDomainIds: {
      vllm: ["fused-moe"],
      "vllm-ascend": ["fused-moe-ops", "eplb"],
    },
    legacyDomainNames: ["FusedMoE"],
  },
  "Model Runner": {
    description: "输入批处理、模型执行、图捕获以及设备能力注册的连接层。",
    pipeline: "Request Batch → Input Builder → Model Runner → Graph Replay",
    upstreamPaths: ["vllm/v1/worker/", "vllm/v1/outputs.py"],
    ascendPaths: ["vllm_ascend/worker/v2/", "vllm_ascend/platform.py"],
    testPaths: ["tests/v1/worker/", "tests/unit_tests/worker/", "tests/e2e/singlecard/graph/"],
    symbols: ["GPUModelRunner", "InputBatch", "NPUModelRunner", "AscendInputBatch"],
    taxonomyDomainIds: {
      vllm: ["engine-model-runner"],
      "vllm-ascend": ["worker-graph", "xlite"],
    },
    legacyDomainNames: ["Model Runner"],
  },
  Scheduler: {
    description: "请求排队、抢占、KV block 分配与长短请求公平性。",
    pipeline: "Request Queue → Scheduling → KV Allocation → Execute",
    upstreamPaths: ["vllm/v1/core/sched/", "vllm/config/scheduler.py"],
    ascendPaths: ["vllm_ascend/core/", "vllm_ascend/patch/core/", "vllm_ascend/kv_offload/"],
    testPaths: ["tests/v1/core/", "tests/unit_tests/core/", "tests/e2e/singlecard/prefix_caching/"],
    symbols: ["Scheduler", "KVCacheManager", "block table", "batch reorder"],
    taxonomyDomainIds: {
      vllm: ["scheduler-kv-cache"],
      "vllm-ascend": ["core-scheduler-kv-cache", "kv-offload"],
    },
    legacyDomainNames: ["Scheduler"],
  },
  Attention: {
    description: "Prefill、Decode、MLA 与 KV Cache 的设备后端实现。",
    pipeline: "QKV Projection → Attention Backend → KV Cache → Output",
    upstreamPaths: ["vllm/model_executor/layers/attention/", "vllm/v1/attention/"],
    ascendPaths: ["vllm_ascend/attention/", "vllm_ascend/worker/block_table.py"],
    testPaths: ["tests/kernels/attention/", "tests/v1/attention/", "tests/unit_tests/attention/"],
    symbols: ["AttentionBackend", "MLACommonImpl", "AscendAttentionBackend", "MLAImpl"],
    taxonomyDomainIds: {
      vllm: ["attention"],
      "vllm-ascend": ["attention"],
    },
    legacyDomainNames: ["Attention"],
  },
  Distributed: {
    description: "多进程执行、Collective RPC、HCCL 与跨节点通信生命周期。",
    pipeline: "Executor → Worker Group → Collective RPC → Device Comm",
    upstreamPaths: ["vllm/executor/", "vllm/distributed/"],
    ascendPaths: ["vllm_ascend/worker/", "vllm_ascend/distributed/"],
    testPaths: ["tests/distributed/", "tests/v1/kv_connector/", "tests/unit_tests/distributed/", "tests/e2e/pd/"],
    symbols: ["MultiprocExecutor", "CollectiveRPC", "WorkerWrapper", "HCCL communicator"],
    taxonomyDomainIds: {
      vllm: ["distributed-kv-transfer"],
      "vllm-ascend": ["distributed-kv-transfer"],
    },
    legacyDomainNames: ["Distributed"],
  },
  "CI / Infra": {
    description: "构建矩阵、缓存、镜像与跨设备测试基础设施。",
    pipeline: "Source → Build Cache → Image → Test Matrix → Signal",
    upstreamPaths: [".buildkite/", ".github/workflows/"],
    ascendPaths: [".github/workflows/", "docker/"],
    testPaths: ["runner images", "cache archives"],
    symbols: ["test selection", "CSRC cache", "multi-device matrix", "cache provenance"],
    taxonomyDomainIds: {
      vllm: ["ci-infra"],
      "vllm-ascend": ["ci-infra"],
    },
    legacyDomainNames: ["CI / Infra"],
  },
  "Compilation & Kernels": {
    description: "编译图、IR、融合 pass 与设备算子内核的生成和执行基础设施。",
    pipeline: "Python Graph → Compiler Pass → Kernel Selection → Device Execute",
    upstreamPaths: ["vllm/compilation/", "vllm/ir/", "vllm/kernels/", "csrc/"],
    ascendPaths: ["vllm_ascend/compilation/", "csrc/"],
    testPaths: ["tests/compile/", "tests/kernels/", "tests/compilation/"],
    symbols: ["VllmBackend", "FusionPass", "AscendCompiler", "custom kernel"],
    taxonomyDomainIds: {
      vllm: ["compilation-kernels"],
      "vllm-ascend": ["compilation"],
    },
  },
  "Models & Multimodal": {
    description: "模型注册、权重装载以及图像、音频、视频等多模态输入的适配链路。",
    pipeline: "Model Config → Weight Loading → Input Processor → Model Execute",
    upstreamPaths: ["vllm/model_executor/models/", "vllm/model_executor/model_loader/", "vllm/multimodal/"],
    ascendPaths: ["vllm_ascend/models/", "vllm_ascend/model_loader/", "vllm_ascend/patch/models/"],
    testPaths: ["tests/models/", "tests/model_executor/model_loader/", "tests/multimodal/", "tests/unit_tests/model_loader/", "tests/unit_tests/models/"],
    symbols: ["ModelRegistry", "BaseModelLoader", "AscendModelLoader", "MultiModalRegistry"],
    taxonomyDomainIds: {
      vllm: ["model-support-loading", "multimodal"],
      "vllm-ascend": ["model-loading-weight-transfer", "models-multimodal"],
    },
  },
  Quantization: {
    description: "低精度权重、量化方法选择与设备量化算子之间的执行映射。",
    pipeline: "Quant Config → Weight Transform → Quant Method → Kernel Execute",
    upstreamPaths: ["vllm/model_executor/layers/quantization/"],
    ascendPaths: ["vllm_ascend/quantization/"],
    testPaths: ["tests/quantization/", "tests/unit_tests/quantization/", "tests/e2e/singlecard/quantization/"],
    symbols: ["QuantizationConfig", "QuantizeMethodBase", "AscendQuantConfig", "W8A8"],
    taxonomyDomainIds: {
      vllm: ["quantization"],
      "vllm-ascend": ["quantization"],
    },
  },
  "Speculative Decoding": {
    description: "Draft/Target 协作、候选 token 生成以及 accept/reject 的推测解码链路。",
    pipeline: "Draft Propose → Target Verify → Accept/Reject → Sequence Advance",
    upstreamPaths: ["vllm/v1/spec_decode/", "vllm/config/speculative.py"],
    ascendPaths: ["vllm_ascend/spec_decode/"],
    testPaths: ["tests/v1/spec_decode/", "tests/spec_decode/", "tests/unit_tests/spec_decode/"],
    symbols: ["SpeculativeConfig", "Proposer", "AscendSpecDecode", "MTP"],
    taxonomyDomainIds: {
      vllm: ["speculative-decoding"],
      "vllm-ascend": ["speculative-decoding"],
    },
  },
  "Sampling & Structured Output": {
    description: "Logits 处理、采样、受约束生成以及 reasoning/tool parser 的输出链路。",
    pipeline: "Logits → Processor → Sampler → Structured Output",
    upstreamPaths: ["vllm/v1/sample/", "vllm/v1/structured_output/", "vllm/tool_parsers/"],
    ascendPaths: ["vllm_ascend/sample/"],
    testPaths: ["tests/v1/sample/", "tests/v1/structured_output/", "tests/unit_tests/sample/", "tests/samplers/"],
    symbols: ["Sampler", "StructuredOutputManager", "AscendSampler", "logprobs"],
    taxonomyDomainIds: {
      vllm: ["sampling-output"],
      "vllm-ascend": ["sampling"],
    },
  },
  "Serving & Frontend": {
    description: "对外 API、命令行入口以及 Rust/Python 前端与 Engine 的协议边界。",
    pipeline: "Client Request → API Protocol → Frontend → Engine Client",
    upstreamPaths: ["vllm/entrypoints/", "vllm/serve/", "rust/"],
    ascendPaths: [],
    testPaths: ["tests/entrypoints/", "tests/serve/", "rust/"],
    symbols: ["OpenAIServing", "EngineClient", "API protocol", "CLI"],
    taxonomyDomainIds: {
      vllm: ["serving-api", "rust-frontend"],
      "vllm-ascend": [],
    },
  },
  "Platform, Device & Memory": {
    description: "平台注册、硬件能力、设备内存与跨版本兼容补丁的承载层。",
    pipeline: "Platform Detect → Device Init → Memory Manage → Capability Dispatch",
    upstreamPaths: ["vllm/platforms/", "vllm/device_allocator/"],
    ascendPaths: ["vllm_ascend/platform.py", "vllm_ascend/device/", "vllm_ascend/device_allocator/", "vllm_ascend/patch/"],
    testPaths: ["tests/platforms/", "tests/unit_tests/device/", "tests/unit_tests/device_allocator/", "tests/e2e/singlecard/profiling/"],
    symbols: ["Platform", "DeviceMemoryManager", "NPUPlatform", "DeviceAllocator"],
    taxonomyDomainIds: {
      vllm: ["platform-hardware"],
      "vllm-ascend": ["platform-patches", "device-memory"],
    },
  },
  LoRA: {
    description: "Adapter 的装载、激活、运行时切换与 LoRA 融合层实现。",
    pipeline: "Adapter Request → Load Weights → Activate Mapping → Layer Execute",
    upstreamPaths: ["vllm/lora/"],
    ascendPaths: ["vllm_ascend/lora/"],
    testPaths: ["tests/lora/", "tests/unit_tests/lora/", "tests/e2e/singlecard/lora/"],
    symbols: ["LoRAModelManager", "LoRARequest", "AscendLoRA", "PunicaWrapper"],
    taxonomyDomainIds: {
      vllm: ["lora"],
      "vllm-ascend": ["lora"],
    },
  },
  "Documentation & Tests": {
    description: "纯文档、通用测试夹具与尚不能可靠映射回具体源码领域的验证基础设施。",
    pipeline: "Specification → Test Harness → Validation → Documentation",
    upstreamPaths: ["docs/", "tests/"],
    ascendPaths: ["docs/", "tests/"],
    testPaths: ["tests/", "tests/e2e/"],
    symbols: ["documentation", "fixture", "E2E taxonomy", "test harness"],
    taxonomyDomainIds: {
      vllm: ["documentation", "tests"],
      "vllm-ascend": ["documentation", "tests"],
    },
  },
};
