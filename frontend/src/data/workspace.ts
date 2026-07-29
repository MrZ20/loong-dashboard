import type {
  AIInsight,
  CommunityItem,
  CrossRepoImpact,
  DomainMap,
  WatchlistMeta,
} from "../types";

export function communityItemKey(item: Pick<CommunityItem, "repo" | "kind" | "id">) {
  return `${item.repo}:${item.kind}:${item.id}`;
}

export const initialWatchlistKeys = [
  "vllm-ascend:pr:13123",
  "vllm-ascend:issue:9821",
  "vllm:pr:25826",
  "vllm:issue:21408",
];

export const aiInsights: AIInsight[] = [
  {
    id: "qwen3-regression",
    kind: "risk",
    severity: "critical",
    title: "Qwen3-235B 吞吐回归需要优先升级",
    summary:
      "CANN 8.3 后的性能下降集中在 decode 阶段，同时 FusedMoE 通信路径近期有变更，两类信号在时间上高度重合。",
    domain: "FusedMoE",
    confidence: 92,
    sources: ["vllm-ascend #9821", "vllm-ascend #13094", "今日分析"],
    action: "补充 8.2 / 8.3 逐层 profiler，并优先比较 All-to-All 通信占比。",
    window: "24h",
  },
  {
    id: "rpc-adaptation",
    kind: "upstream",
    severity: "high",
    title: "上游 RPC 生命周期重构可能改变 HCCL 初始化顺序",
    summary:
      "vLLM 已统一 collective RPC 的启动与退出钩子，Ascend worker wrapper 和多机启动问题可能共享同一初始化边界。",
    domain: "Distributed",
    confidence: 87,
    sources: ["vllm #25826", "vllm-ascend #9798", "跨仓库影响"],
    action: "按成功、异常退出两条路径核对 communicator 建立与资源回收时序。",
    window: "24h",
  },
  {
    id: "mrv2-input-stability",
    kind: "trend",
    severity: "medium",
    title: "MRV2 的风险中心正在从功能接入转向输入语义稳定性",
    summary:
      "dummy batch、图捕获与多卡形状推导连续出现相关改动，说明 InputBatch 已成为 Model Runner V2 的关键验证边界。",
    domain: "Model Runner",
    confidence: 84,
    sources: ["vllm-ascend #13123", "Model Runner 领域地图"],
    action: "将 dummy input、TP token 分布和 graph reuse 合并为一组回归矩阵。",
    window: "24h",
  },
  {
    id: "fused-moe-ep",
    kind: "trend",
    severity: "medium",
    title: "Expert Parallel 已成为 A3 多卡优化主线",
    summary:
      "过去一周 FusedMoE 相关 PR 的重心由单算子性能转向 All-to-All、拓扑选择与长稳验证，领域热度持续上升。",
    domain: "FusedMoE",
    confidence: 89,
    sources: ["8 个活跃 PR", "4 个开放 Issue", "技术领域地图"],
    action: "后续日报将通信拓扑、算子选择和吞吐回归作为同一分析链。",
    window: "7d",
  },
  {
    id: "capability-rfc",
    kind: "collaboration",
    severity: "medium",
    title: "设备能力注册 RFC 进入适合 Ascend 提前发声的窗口",
    summary:
      "上游仍在讨论统一能力声明的边界，当前比实现阶段更适合补充 attention、quantization 与组合能力需求。",
    domain: "Model Runner",
    confidence: 81,
    sources: ["vllm #21408", "跨仓库影响", "7 天讨论趋势"],
    action: "在 RFC 收敛前整理 Ascend 分散能力判断清单并形成评论要点。",
    window: "7d",
  },
];

export const watchlistMeta: Record<string, WatchlistMeta> = {
  "vllm-ascend:pr:13123": {
    reason: "等待 Review",
    note: "重点确认 TP 场景下 dummy token 分布是否与真实 batch 一致。",
    priority: "P1",
    nextCheck: "今天 16:00",
  },
  "vllm-ascend:issue:9821": {
    reason: "性能回归",
    note: "等待补充 CANN 8.2 与 8.3 的逐层 profiler 对比。",
    priority: "P0",
    nextCheck: "今天 14:30",
  },
  "vllm:pr:25826": {
    reason: "可能影响 Ascend",
    note: "需要核对 worker wrapper 的 RPC 初始化与异常回收顺序。",
    priority: "P1",
    nextCheck: "明天",
  },
  "vllm:issue:21408": {
    reason: "架构 RFC",
    note: "准备 Ascend capability registry 的组合能力诉求。",
    priority: "P1",
    nextCheck: "周三周会前",
  },
};

export const crossRepoImpacts: CrossRepoImpact[] = [
  {
    id: "rpc-lifecycle",
    source: {
      repo: "vllm",
      kind: "pr",
      number: 25826,
      title: "Refactor collective RPC lifecycle in multiprocess executor",
    },
    domain: "Distributed",
    level: "high",
    status: "needs_adaptation",
    analysis:
      "上游统一了 collective RPC 生命周期，Ascend worker wrapper 覆盖了启动与退出钩子，需要确认 communicator 建立和异常资源回收顺序。",
    changedPaths: [
      "vllm/executor/multiproc_executor.py",
      "vllm/distributed/rpc/lifecycle.py",
    ],
    ascendPaths: [
      "vllm_ascend/worker/worker_wrapper.py",
      "vllm_ascend/distributed/",
    ],
    relatedItem: "vllm-ascend #9798",
  },
  {
    id: "scheduler-budget",
    source: {
      repo: "vllm",
      kind: "pr",
      number: 25841,
      title: "[Scheduler] Introduce preemption budget for long-context batches",
    },
    domain: "Scheduler",
    level: "medium",
    status: "possibly_affected",
    analysis:
      "调度策略新增预算状态和配置字段。Ascend 大部分可继承上游实现，但需要确认配置透传以及图模式批次重排是否保留预算语义。",
    changedPaths: [
      "vllm/v1/core/sched/scheduler.py",
      "vllm/config/scheduler.py",
    ],
    ascendPaths: [
      "vllm_ascend/core/scheduler/",
      "vllm_ascend/worker/v2/",
    ],
  },
  {
    id: "capability-registry",
    source: {
      repo: "vllm",
      kind: "issue",
      number: 21408,
      title: "RFC: Unify device plugin capability discovery",
    },
    domain: "Model Runner",
    level: "high",
    status: "unreviewed",
    analysis:
      "RFC 可能收敛设备能力声明入口。需要先盘点 Ascend 在 attention、quantization、worker 中的分散判断，再向上游补充组合能力需求。",
    changedPaths: [
      "vllm/platforms/",
      "vllm/config/",
    ],
    ascendPaths: [
      "vllm_ascend/platform.py",
      "vllm_ascend/attention/",
      "vllm_ascend/quantization/",
    ],
  },
  {
    id: "mla-descriptor-cache",
    source: {
      repo: "vllm",
      kind: "pr",
      number: 25793,
      title: "Optimize MLA decode with persistent cache descriptors",
    },
    domain: "Attention",
    level: "medium",
    status: "possibly_affected",
    analysis:
      "上游通过 descriptor 缓存降低 MLA decode 热路径开销。Ascend 可复用失效策略，但设备侧 descriptor 生命周期需要独立验证。",
    changedPaths: ["vllm/v1/attention/backends/mla/common.py"],
    ascendPaths: [
      "vllm_ascend/attention/mla_v1.py",
      "tests/attention/",
    ],
  },
];

export const domainMaps: DomainMap[] = [
  {
    id: "fused-moe",
    name: "FusedMoE",
    description: "专家路由、融合算子与 Expert Parallel 通信的核心执行领域。",
    pipelinePosition: "Model Execute → Router → Expert Dispatch → Expert Compute",
    keywords: ["MoE", "Expert Parallel", "All-to-All", "Grouped MatMul"],
    activity: { pulls: 8, issues: 4, risks: 2, trend: "升温" },
    stages: [
      {
        label: "vLLM 上游核心",
        repository: "vllm",
        paths: ["vllm/model_executor/layers/fused_moe/"],
        symbols: ["FusedMoE", "FusedMoEMethodBase"],
      },
      {
        label: "Ascend 适配层",
        repository: "vllm-ascend",
        paths: ["vllm_ascend/ops/fused_moe/", "vllm_ascend/distributed/"],
        symbols: ["AscendFusedMoE", "ExpertParallel"],
      },
      {
        label: "验证与测试",
        repository: "tests",
        paths: ["tests/ops/fused_moe/", "tests/distributed/"],
        symbols: ["A2/A3 correctness", "EP throughput"],
      },
    ],
    currentWork: [
      "#13094 A3 EP all-to-all 已合入",
      "#9821 CANN 8.3 decode 吞吐回归待定位",
    ],
    insight:
      "当前热度由 A3 Expert Parallel 和 Qwen3 性能回归共同推动。建议把通信拓扑、算子选择与长稳验证作为一条连续分析链。",
  },
  {
    id: "model-runner",
    name: "Model Runner",
    description: "输入批处理、模型执行、图捕获以及设备能力注册的连接层。",
    pipelinePosition: "Request Batch → Input Builder → Model Runner → Graph Replay",
    keywords: ["MRV2", "Input Batch", "ACLGraph", "Capability"],
    activity: { pulls: 6, issues: 5, risks: 2, trend: "升温" },
    stages: [
      {
        label: "vLLM 上游核心",
        repository: "vllm",
        paths: ["vllm/v1/worker/", "vllm/v1/outputs.py"],
        symbols: ["GPUModelRunner", "InputBatch"],
      },
      {
        label: "Ascend 适配层",
        repository: "vllm-ascend",
        paths: ["vllm_ascend/worker/v2/", "vllm_ascend/platform.py"],
        symbols: ["NPUModelRunner", "AscendInputBatch"],
      },
      {
        label: "验证与测试",
        repository: "tests",
        paths: ["tests/model_runner_v2/", "tests/graph/"],
        symbols: ["dummy input", "graph reuse"],
      },
    ],
    currentWork: [
      "#13123 dummy token 分布修复等待 Review",
      "#21408 capability registry RFC 待评估",
    ],
    insight:
      "MRV2 正在同时经历输入语义修复和能力注册重构。代码地图应优先关注 InputBatch、图捕获边界与平台能力声明的三点联动。",
  },
  {
    id: "scheduler",
    name: "Scheduler",
    description: "请求排队、抢占、KV block 分配与长短请求公平性。",
    pipelinePosition: "Request Queue → Scheduling → KV Allocation → Execute",
    keywords: ["Preemption", "KV Block", "Fairness", "Spec Decode"],
    activity: { pulls: 5, issues: 6, risks: 2, trend: "稳定" },
    stages: [
      {
        label: "vLLM 上游核心",
        repository: "vllm",
        paths: ["vllm/v1/core/sched/", "vllm/config/scheduler.py"],
        symbols: ["Scheduler", "KVCacheManager"],
      },
      {
        label: "Ascend 适配层",
        repository: "vllm-ascend",
        paths: ["vllm_ascend/core/scheduler/", "vllm_ascend/worker/v2/"],
        symbols: ["NPU block table", "batch reorder"],
      },
      {
        label: "验证与测试",
        repository: "tests",
        paths: ["tests/v1/core/", "tests/e2e/"],
        symbols: ["mixed SLO", "abort lifecycle"],
      },
    ],
    currentWork: [
      "#25841 长上下文抢占预算等待 Review",
      "#21366 speculative abort KV 泄漏待复现",
    ],
    insight:
      "上游调度变化通常可直接继承，但配置字段、block table 和图模式 batch 重排是 Ascend 最容易出现语义偏差的三个接口。",
  },
  {
    id: "attention",
    name: "Attention",
    description: "Prefill、Decode、MLA 与 KV Cache 的设备后端实现。",
    pipelinePosition: "QKV Projection → Attention Backend → KV Cache → Output",
    keywords: ["MLA", "Prefix Cache", "Flash Attention", "Paged KV"],
    activity: { pulls: 7, issues: 3, risks: 2, trend: "升温" },
    stages: [
      {
        label: "vLLM 上游核心",
        repository: "vllm",
        paths: ["vllm/v1/attention/", "vllm/attention/"],
        symbols: ["AttentionBackend", "MLACommonImpl"],
      },
      {
        label: "Ascend 适配层",
        repository: "vllm-ascend",
        paths: ["vllm_ascend/attention/", "vllm_ascend/worker/block_table.py"],
        symbols: ["AscendAttentionBackend", "MLAImpl"],
      },
      {
        label: "验证与测试",
        repository: "tests",
        paths: ["tests/attention/", "tests/long_context/"],
        symbols: ["prefix hit", "descriptor invalidation"],
      },
    ],
    currentWork: [
      "#13062 MLA prefix cache 有 2 项测试失败",
      "#25793 descriptor cache 收到修改请求",
    ],
    insight:
      "MLA 与 prefix cache 正在成为共同热点。需要把 descriptor 失效条件、block table 恢复和长序列回收放在同一验证矩阵中。",
  },
  {
    id: "distributed",
    name: "Distributed",
    description: "多进程执行、Collective RPC、HCCL 与跨节点通信生命周期。",
    pipelinePosition: "Executor → Worker Group → Collective RPC → Device Comm",
    keywords: ["RPC", "HCCL", "Tensor Parallel", "Multi-node"],
    activity: { pulls: 4, issues: 5, risks: 2, trend: "稳定" },
    stages: [
      {
        label: "vLLM 上游核心",
        repository: "vllm",
        paths: ["vllm/executor/", "vllm/distributed/"],
        symbols: ["MultiprocExecutor", "CollectiveRPC"],
      },
      {
        label: "Ascend 适配层",
        repository: "vllm-ascend",
        paths: ["vllm_ascend/worker/", "vllm_ascend/distributed/"],
        symbols: ["WorkerWrapper", "HCCL communicator"],
      },
      {
        label: "验证与测试",
        repository: "tests",
        paths: ["tests/distributed/", "tests/multi_node/"],
        symbols: ["startup order", "abnormal exit"],
      },
    ],
    currentWork: [
      "#25826 RPC lifecycle 已合入上游",
      "#9798 多机 TP 偶发启动卡死",
    ],
    insight:
      "上游生命周期重构与现有 HCCL 启动卡死可能在初始化顺序上相关，应先建立成功与失败路径的阶段化时间线。",
  },
  {
    id: "ci-infra",
    name: "CI / Infra",
    description: "构建矩阵、缓存、镜像与跨设备测试基础设施。",
    pipelinePosition: "Source → Build Cache → Image → Test Matrix → Signal",
    keywords: ["BuildKit", "CSRC Cache", "CANN", "Flaky Test"],
    activity: { pulls: 3, issues: 2, risks: 1, trend: "稳定" },
    stages: [
      {
        label: "vLLM 上游核心",
        repository: "vllm",
        paths: [".buildkite/", ".github/workflows/"],
        symbols: ["test selection", "failure triage"],
      },
      {
        label: "Ascend 适配层",
        repository: "vllm-ascend",
        paths: [".github/workflows/", "docker/"],
        symbols: ["CSRC cache", "multi-device matrix"],
      },
      {
        label: "验证与测试",
        repository: "CI",
        paths: ["runner images", "cache archives"],
        symbols: ["cache provenance", "flaky clusters"],
      },
    ],
    currentWork: [
      "#13081 CANN minor cache key 草案",
      "主分支与 release 分支缓存兼容性检查",
    ],
    insight:
      "当前风险不在单个 workflow，而在缓存元数据、压缩工具与构建矩阵之间的一致性。地图应突出所有独立 cache job。",
  },
];
