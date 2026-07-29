import type { CommunityItem, RepositoryMeta } from "../types";

export const repositories: RepositoryMeta[] = [
  {
    id: "vllm-ascend",
    owner: "vllm-project",
    name: "vllm-ascend",
    description: "vLLM on Ascend NPU",
    stars: "2.8k",
    openPulls: 86,
    openIssues: 142,
  },
  {
    id: "vllm",
    owner: "vllm-project",
    name: "vllm",
    description: "High-throughput LLM inference",
    stars: "67.4k",
    openPulls: 412,
    openIssues: 1_300,
  },
];

export const domainOptions = [
  "全部领域",
  "Model Runner",
  "FusedMoE",
  "Scheduler",
  "Attention",
  "CI / Infra",
  "Distributed",
];

export const communityItems: CommunityItem[] = [
  {
    id: 13123,
    repo: "vllm-ascend",
    kind: "pr",
    state: "open",
    title: "[MRV2][BugFix] Fix token distribution in make_dummy for AscendInputBatch",
    author: "zouzy5137",
    time: "1 小时前",
    statusText: "Review required",
    domain: "Model Runner",
    important: true,
    summary:
      "修复 MRV2 dummy batch 的 token 分布与真实输入不一致问题，避免图模式下批次形状推导出现偏差。",
    body:
      "在 Model Runner V2 的 dummy input 构造流程中，AscendInputBatch 没有沿用实际调度阶段的 token 分配方式。本 PR 调整 make_dummy 的输入布局，让预热阶段与运行阶段保持相同的 token 分布语义。",
    comments: 6,
    diff: {
      files: 4,
      additions: 86,
      deletions: 24,
      entries: [
        {
          path: "vllm_ascend/worker/v2/ascend_input_batch.py",
          additions: 46,
          deletions: 11,
        },
        {
          path: "tests/model_runner_v2/test_input_batch.py",
          additions: 31,
          deletions: 4,
        },
        {
          path: "vllm_ascend/worker/v2/model_runner.py",
          additions: 7,
          deletions: 7,
        },
      ],
    },
    deepAnalysis: {
      overview:
        "改动集中在 V2 输入批次的预热构造路径，没有改变调度器接口；核心是让 dummy tokens 的 slot 映射与真实 batch 对齐。",
      impact:
        "直接影响启用 MRV2 与图模式的 Ascend 推理任务，尤其是混合长度 batch 的首次编译与后续图复用。",
      risks: [
        "不同 block size 下的边界分配仍依赖上游约束。",
        "当前测试覆盖单卡，需要补充 TP 场景的形状一致性验证。",
      ],
      suggestions: [
        "增加 TP=2 且 mixed prompt length 的回归用例。",
        "对比 vLLM 上游 InputBatch 的 dummy 构造语义。",
      ],
    },
  },
  {
    id: 13094,
    repo: "vllm-ascend",
    kind: "pr",
    state: "merged",
    title: "[FusedMoE] Enable EP all-to-all for DeepSeek V3 on A3",
    author: "xiaoli-npu",
    time: "3 小时前",
    statusText: "Merged",
    domain: "FusedMoE",
    important: true,
    summary:
      "为 A3 打通 Expert Parallel all-to-all 通路，减少 DeepSeek V3 多卡推理中的专家通信开销。",
    body:
      "引入面向 A3 的 EP 通信后端，并在 FusedMoE 路径中按拓扑选择 all-to-all 实现。该实现保留原有 AllGather 回退路径。",
    comments: 18,
    diff: {
      files: 9,
      additions: 312,
      deletions: 74,
      entries: [
        {
          path: "vllm_ascend/distributed/communication_op.py",
          additions: 126,
          deletions: 28,
        },
        {
          path: "vllm_ascend/ops/fused_moe/expert_parallel.py",
          additions: 105,
          deletions: 30,
        },
        {
          path: "tests/distributed/test_ep_a2a.py",
          additions: 68,
          deletions: 8,
        },
      ],
    },
    deepAnalysis: {
      overview:
        "新增的 A3 通信实现被封装在既有 EP 抽象下，主执行路径只增加能力探测和策略选择。",
      impact:
        "对 DeepSeek 系列的多卡吞吐有明显正向价值，也为后续低延迟 all-to-all 优化提供统一入口。",
      risks: [
        "不同集群拓扑下的收益可能差异较大。",
        "通信 buffer 生命周期需要结合长稳测试继续观察。",
      ],
      suggestions: [
        "补充 2/4/8 卡吞吐与 P99 对比。",
        "记录 fallback 触发原因，便于线上诊断。",
      ],
    },
  },
  {
    id: 13081,
    repo: "vllm-ascend",
    kind: "pr",
    state: "draft",
    title: "[CI] Split custom-kernel build cache by CANN minor version",
    author: "ci-bot",
    time: "5 小时前",
    statusText: "Draft",
    domain: "CI / Infra",
    summary:
      "调整自定义算子缓存维度，避免不同 CANN 小版本复用不兼容的编译产物。",
    body:
      "当前 CSRC 缓存只包含设备与 Python 版本。该草案把 CANN minor version 加入 cache key，并保留旧 key 的 restore fallback。",
    comments: 4,
    diff: {
      files: 3,
      additions: 47,
      deletions: 19,
      entries: [
        {
          path: ".github/workflows/_ensure_csrc_cache.yaml",
          additions: 28,
          deletions: 10,
        },
        {
          path: ".github/workflows/pr_test.yaml",
          additions: 15,
          deletions: 7,
        },
      ],
    },
    deepAnalysis: {
      overview:
        "改动只涉及缓存键和回退策略，目标是用较小的命中率成本换取构建产物的确定性。",
      impact:
        "会影响所有依赖 CSRC archive 的 PR jobs，首次运行耗时可能增加，后续命中更可靠。",
      risks: [
        "矩阵中的 CANN 版本格式必须标准化。",
        "restore-key 过宽仍可能回退到不兼容缓存。",
      ],
      suggestions: [
        "在每个独立 cache job 前统一校验 zstd。",
        "展示命中 key 与 archive compression 元数据。",
      ],
    },
  },
  {
    id: 13062,
    repo: "vllm-ascend",
    kind: "pr",
    state: "open",
    title: "Support prefix caching with MLA on Ascend",
    author: "lin-ascend",
    time: "昨天",
    statusText: "2 checks failing",
    domain: "Attention",
    summary:
      "补齐 MLA 场景的 prefix cache 元数据同步，但当前有两项长序列回归测试失败。",
    body:
      "为 MLA backend 增加 prefix cache block table 同步，并更新 KV cache manager 的能力声明。当前 PR 仍在定位长序列下的 block 回收失败。",
    comments: 12,
    diff: {
      files: 7,
      additions: 188,
      deletions: 63,
      entries: [
        {
          path: "vllm_ascend/attention/mla_v1.py",
          additions: 89,
          deletions: 29,
        },
        {
          path: "vllm_ascend/worker/block_table.py",
          additions: 54,
          deletions: 22,
        },
      ],
    },
    deepAnalysis: {
      overview:
        "该 PR 把 prefix caching 接入 MLA backend，核心变化位于 block table 重建与 cache hit 之后的元数据恢复。",
      impact:
        "如果稳定，可显著降低重复长前缀请求的首 token 延迟；目前失败用例说明回收语义仍需收敛。",
      risks: [
        "长序列块回收可能造成 cache table 与设备侧状态不同步。",
        "MLA 与 MHA 的 slot mapping 假设并不完全相同。",
      ],
      suggestions: [
        "先把两项失败测试拆成最小 block 生命周期序列。",
        "加入命中后 block table 快照对比。",
      ],
    },
  },
  {
    id: 9821,
    repo: "vllm-ascend",
    kind: "issue",
    state: "open",
    title: "Qwen3-235B throughput regression after CANN 8.3 update",
    author: "benchmark-lab",
    time: "2 小时前",
    statusText: "Needs investigation",
    domain: "FusedMoE",
    important: true,
    summary:
      "升级 CANN 8.3 后 Qwen3-235B 吞吐下降约 11%，回归集中在 decode 阶段的 MoE 通信与算子调度。",
    body:
      "在相同镜像、权重和压测参数下，CANN 8.3 相比 8.2.RC1 的 output throughput 下降约 11%。Prefill 基本持平，decode latency 增长明显。",
    comments: 21,
    deepAnalysis: {
      overview:
        "现象集中在 decode，且模型为 MoE，优先怀疑专家通信或小 batch 算子调度变化，而非权重加载与前处理。",
      impact:
        "影响 A3 上 Qwen3 大模型的生产吞吐，属于需要跨 CANN 与 vLLM-Ascend 联合定位的性能回归。",
      risks: [
        "当前数据只有单一 batch 与并发参数。",
        "未排除镜像内其他依赖升级。",
      ],
      suggestions: [
        "补充逐层 profiler 对比并锁定通信占比。",
        "用相同 wheel 在两套 CANN 环境交叉验证。",
      ],
    },
  },
  {
    id: 9798,
    repo: "vllm-ascend",
    kind: "issue",
    state: "open",
    title: "Intermittent hang in multi-node tensor parallel startup",
    author: "cloud-runtime",
    time: "7 小时前",
    statusText: "Triaged",
    domain: "Distributed",
    summary:
      "多机 TP 初始化存在低概率卡死，日志停留在 HCCL communicator 建立阶段，暂未发现稳定复现条件。",
    body:
      "在 2 节点、每节点 8 卡的部署中，大约 1/30 次启动会停留在 communicator 初始化。重启后通常恢复。",
    comments: 9,
    deepAnalysis: {
      overview:
        "卡点位于分布式通信初始化，可能与 rank 启动顺序、网卡选择或异常进程残留有关。",
      impact:
        "对弹性扩缩容和自动恢复影响较大，但当前发生频率低且缺少最小复现。",
      risks: [
        "现有日志粒度不足以区分 rendezvous 与 HCCL 内部卡点。",
        "多机环境变量差异可能掩盖根因。",
      ],
      suggestions: [
        "对各 rank 的初始化阶段增加带时间戳埋点。",
        "采集失败与成功启动的网络与进程快照。",
      ],
    },
  },
  {
    id: 9783,
    repo: "vllm-ascend",
    kind: "issue",
    state: "closed",
    title: "Incorrect max model length validation for multimodal models",
    author: "model-support",
    time: "昨天",
    statusText: "Closed as fixed",
    domain: "Model Runner",
    summary:
      "多模态模型长度校验没有计入视觉 token，相关修复已在 #13048 合入并关闭该问题。",
    body:
      "部分多模态模型在请求进入 model runner 后才触发长度错误。问题来自校验阶段遗漏视觉 token。",
    comments: 5,
    deepAnalysis: {
      overview:
        "问题已由关联 PR 修复，修改在请求校验层完成，对后续执行路径没有结构性影响。",
      impact: "降低多模态超长输入的晚失败概率，改善错误信息可解释性。",
      risks: ["不同 processor 的视觉 token 估算仍需保持一致。"],
      suggestions: ["把关联回归用例纳入多模态模型公共测试集。"],
    },
  },
  {
    id: 25841,
    repo: "vllm",
    kind: "pr",
    state: "open",
    title: "[Scheduler] Introduce preemption budget for long-context batches",
    author: "sarah-chen",
    time: "38 分钟前",
    statusText: "Review required",
    domain: "Scheduler",
    important: true,
    summary:
      "为长上下文批次增加抢占预算，避免短请求持续挤压长请求；Ascend 调度适配可能需要同步新配置字段。",
    body:
      "新增基于 token cost 的 preemption budget，并在 scheduler step 中记录被延迟请求的累计预算。该策略默认关闭。",
    comments: 14,
    diff: {
      files: 11,
      additions: 274,
      deletions: 96,
      entries: [
        {
          path: "vllm/v1/core/sched/scheduler.py",
          additions: 122,
          deletions: 47,
        },
        {
          path: "vllm/config/scheduler.py",
          additions: 51,
          deletions: 12,
        },
        {
          path: "tests/v1/core/test_scheduler.py",
          additions: 82,
          deletions: 29,
        },
      ],
    },
    deepAnalysis: {
      overview:
        "这是调度策略层的可选增强，不改变 request 接口，但引入新的预算状态和配置项。",
      impact:
        "对混合长短请求的公平性有帮助；vLLM-Ascend 如果复用上游 scheduler，多数代码可直接继承。",
      risks: [
        "预算累计可能增加 scheduler 热路径开销。",
        "默认值与旧抢占策略组合需要更多负载验证。",
      ],
      suggestions: [
        "确认 Ascend scheduler 配置透传是否覆盖新增字段。",
        "加入混合 SLO workload 的端到端对比。",
      ],
    },
  },
  {
    id: 25826,
    repo: "vllm",
    kind: "pr",
    state: "merged",
    title: "Refactor collective RPC lifecycle in multiprocess executor",
    author: "michael-vllm",
    time: "4 小时前",
    statusText: "Merged",
    domain: "Distributed",
    summary:
      "统一多进程 executor 的 collective RPC 生命周期，Ascend 自定义 worker wrapper 需要检查初始化顺序兼容性。",
    body:
      "把 collective RPC 的创建、健康检查和关闭收敛到统一 lifecycle manager，减少 executor 实现间的重复代码。",
    comments: 26,
    diff: {
      files: 14,
      additions: 398,
      deletions: 246,
      entries: [
        {
          path: "vllm/executor/multiproc_executor.py",
          additions: 144,
          deletions: 101,
        },
        {
          path: "vllm/distributed/rpc/lifecycle.py",
          additions: 186,
          deletions: 22,
        },
      ],
    },
    deepAnalysis: {
      overview:
        "重构以生命周期管理器替代各 executor 的分散实现，功能意图保持不变但初始化时序发生改变。",
      impact:
        "vLLM-Ascend 的 worker wrapper 若覆盖启动或关闭钩子，需要重点验证 communicator 建立时机。",
      risks: [
        "异常退出分支可能与 Ascend 资源回收顺序冲突。",
        "旧扩展点的隐式调用顺序不再成立。",
      ],
      suggestions: [
        "搜索 Ascend executor 对 RPC startup/shutdown 的覆盖点。",
        "补充异常 worker 退出后的资源回收测试。",
      ],
    },
  },
  {
    id: 25793,
    repo: "vllm",
    kind: "pr",
    state: "open",
    title: "Optimize MLA decode with persistent cache descriptors",
    author: "kernel-team",
    time: "8 小时前",
    statusText: "Changes requested",
    domain: "Attention",
    summary:
      "缓存 MLA decode descriptor 以减少热路径构造开销，Reviewer 关注 descriptor 失效与多模型复用风险。",
    body:
      "在 MLA decode backend 中缓存 shape-stable descriptor，并在 batch layout 变化时重建。初步 benchmark 显示 decode latency 降低 3%–5%。",
    comments: 31,
    diff: {
      files: 6,
      additions: 164,
      deletions: 71,
      entries: [
        {
          path: "vllm/v1/attention/backends/mla/common.py",
          additions: 89,
          deletions: 34,
        },
        {
          path: "tests/v1/attention/test_mla_cache.py",
          additions: 61,
          deletions: 12,
        },
      ],
    },
    deepAnalysis: {
      overview:
        "优化将 descriptor 从逐 step 构造改为按 layout 缓存，性能收益来自减少 Python 与后端对象创建。",
      impact:
        "Ascend MLA backend 可以参考同样思路，但 descriptor 的设备语义和失效条件需要单独定义。",
      risks: [
        "多 LoRA 或动态 batch 下可能复用过期 descriptor。",
        "缓存键如果包含过多维度会削弱收益。",
      ],
      suggestions: [
        "明确列出所有 descriptor 失效条件。",
        "覆盖动态 batch 与模型切换测试。",
      ],
    },
  },
  {
    id: 21408,
    repo: "vllm",
    kind: "issue",
    state: "open",
    title: "RFC: Unify device plugin capability discovery",
    author: "architecture-wg",
    time: "1 小时前",
    statusText: "Discussion",
    domain: "Model Runner",
    important: true,
    summary:
      "提议统一设备插件的能力发现接口，可能改变 Ascend 对 attention、quantization 与 worker 能力的注册方式。",
    body:
      "当前各设备插件通过多处分散配置声明能力。本 RFC 提议引入统一 capability registry，并在启动阶段完成解析。",
    comments: 44,
    deepAnalysis: {
      overview:
        "这是影响设备插件边界的架构提案，尚未进入实现阶段，但会直接触及 Ascend 的能力注册与条件分支。",
      impact:
        "如果落地，vLLM-Ascend 可减少上游兼容补丁，同时需要迁移现有平台检查和插件注册入口。",
      risks: [
        "统一接口可能无法表达设备特有的组合能力。",
        "迁移期需要兼容旧注册机制。",
      ],
      suggestions: [
        "盘点 Ascend 当前所有能力判断位置。",
        "尽早在 RFC 中提交 NPU 组合能力需求。",
      ],
    },
  },
  {
    id: 21366,
    repo: "vllm",
    kind: "issue",
    state: "open",
    title: "Memory leak when aborting requests during speculative decoding",
    author: "serving-team",
    time: "6 小时前",
    statusText: "Confirmed",
    domain: "Scheduler",
    summary:
      "推测解码请求在中途取消时存在 KV block 泄漏，长稳服务的显存占用会逐步增长。",
    body:
      "高频创建并取消 speculative decoding 请求后，可观察到 free KV blocks 持续减少。普通 decoding 路径未复现。",
    comments: 17,
    deepAnalysis: {
      overview:
        "泄漏可能来自 draft 与 target 两套 block 生命周期没有在 abort 分支完全对齐。",
      impact:
        "属于长稳高风险问题；若 Ascend 推测解码复用同一 scheduler 状态机，也可能受影响。",
      risks: [
        "当前复现只覆盖一种 speculative model 配置。",
        "block 统计下降不一定等同于真实设备内存泄漏。",
      ],
      suggestions: [
        "跟踪 abort 前后的 request/block 引用计数。",
        "在 Ascend speculative 路径运行同一复现脚本。",
      ],
    },
  },
];
