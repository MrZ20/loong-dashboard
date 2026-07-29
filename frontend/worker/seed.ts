export const DOMAIN_ARCHITECTURES: Record<
  string,
  {
    description: string;
    pipeline: string;
    upstreamPaths: string[];
    ascendPaths: string[];
    testPaths: string[];
    symbols: string[];
  }
> = {
  FusedMoE: {
    description: "专家路由、融合算子与 Expert Parallel 通信的核心执行领域。",
    pipeline: "Model Execute → Router → Expert Dispatch → Expert Compute",
    upstreamPaths: ["vllm/model_executor/layers/fused_moe/"],
    ascendPaths: ["vllm_ascend/ops/fused_moe/", "vllm_ascend/distributed/"],
    testPaths: ["tests/ops/fused_moe/", "tests/distributed/"],
    symbols: ["FusedMoE", "FusedMoEMethodBase", "AscendFusedMoE", "ExpertParallel"],
  },
  "Model Runner": {
    description: "输入批处理、模型执行、图捕获以及设备能力注册的连接层。",
    pipeline: "Request Batch → Input Builder → Model Runner → Graph Replay",
    upstreamPaths: ["vllm/v1/worker/", "vllm/v1/outputs.py"],
    ascendPaths: ["vllm_ascend/worker/v2/", "vllm_ascend/platform.py"],
    testPaths: ["tests/model_runner_v2/", "tests/graph/"],
    symbols: ["GPUModelRunner", "InputBatch", "NPUModelRunner", "AscendInputBatch"],
  },
  Scheduler: {
    description: "请求排队、抢占、KV block 分配与长短请求公平性。",
    pipeline: "Request Queue → Scheduling → KV Allocation → Execute",
    upstreamPaths: ["vllm/v1/core/sched/", "vllm/config/scheduler.py"],
    ascendPaths: ["vllm_ascend/core/scheduler/", "vllm_ascend/worker/v2/"],
    testPaths: ["tests/v1/core/", "tests/e2e/"],
    symbols: ["Scheduler", "KVCacheManager", "block table", "batch reorder"],
  },
  Attention: {
    description: "Prefill、Decode、MLA 与 KV Cache 的设备后端实现。",
    pipeline: "QKV Projection → Attention Backend → KV Cache → Output",
    upstreamPaths: ["vllm/v1/attention/", "vllm/attention/"],
    ascendPaths: ["vllm_ascend/attention/", "vllm_ascend/worker/block_table.py"],
    testPaths: ["tests/attention/", "tests/long_context/"],
    symbols: ["AttentionBackend", "MLACommonImpl", "AscendAttentionBackend", "MLAImpl"],
  },
  Distributed: {
    description: "多进程执行、Collective RPC、HCCL 与跨节点通信生命周期。",
    pipeline: "Executor → Worker Group → Collective RPC → Device Comm",
    upstreamPaths: ["vllm/executor/", "vllm/distributed/"],
    ascendPaths: ["vllm_ascend/worker/", "vllm_ascend/distributed/"],
    testPaths: ["tests/distributed/", "tests/multi_node/"],
    symbols: ["MultiprocExecutor", "CollectiveRPC", "WorkerWrapper", "HCCL communicator"],
  },
  "CI / Infra": {
    description: "构建矩阵、缓存、镜像与跨设备测试基础设施。",
    pipeline: "Source → Build Cache → Image → Test Matrix → Signal",
    upstreamPaths: [".buildkite/", ".github/workflows/"],
    ascendPaths: [".github/workflows/", "docker/"],
    testPaths: ["runner images", "cache archives"],
    symbols: ["test selection", "CSRC cache", "multi-device matrix", "cache provenance"],
  },
};

export const SEED_COMMUNITY_ITEMS = [
  {
    id: "vllm-ascend:pr:13123",
    repoId: "vllm-ascend",
    kind: "pr",
    number: 13123,
    state: "open",
    title: "[MRV2][BugFix] Fix token distribution in make_dummy for AscendInputBatch",
    author: "zouzy5137",
    bodyMd: `## What this PR does

This PR fixes the token distribution produced by \`AscendInputBatch.make_dummy\` in Model Runner V2.

### Problem

The previous implementation evenly divided tokens by sequence count. That behavior does not match a real tensor-parallel batch when the final sequence contains the remainder. During graph capture this can produce a different shape from the replay batch.

### Changes

- Keep the original total token count.
- Assign the remainder to the final sequence.
- Add coverage for tensor-parallel dummy batches.

### Validation

- [x] Single-device dummy batch
- [x] Tensor-parallel token distribution
- [ ] Multi-node graph replay`,
    comments: 6,
    domain: "Model Runner",
    aiSummary:
      "修复 MRV2 dummy batch 的 token 分布与真实输入不一致问题，避免图模式下批次形状推导出现偏差。",
    statusText: "Review required",
    important: 1,
    updatedAt: "2026-07-30T00:40:00.000Z",
    diff: {
      files: 2,
      additions: 31,
      deletions: 8,
      entries: [
        {
          path: "vllm_ascend/worker/v2/input_batch.py",
          additions: 18,
          deletions: 6,
          patch: `@@ -142,12 +142,24 @@ class AscendInputBatch:
     def make_dummy(self, num_tokens: int, num_seqs: int):
-        tokens_per_seq = num_tokens // num_seqs
-        seq_lens = [tokens_per_seq] * num_seqs
+        if num_seqs <= 0:
+            raise ValueError("num_seqs must be positive")
+
+        tokens_per_seq, remainder = divmod(num_tokens, num_seqs)
+        seq_lens = [tokens_per_seq] * num_seqs
+        # Match the layout produced by a real scheduler batch. Keeping the
+        # remainder on the last sequence also preserves the total token count.
+        seq_lens[-1] += remainder
+
+        assert sum(seq_lens) == num_tokens
         return self._build_dummy(seq_lens)
`,
        },
        {
          path: "tests/model_runner_v2/test_input_batch.py",
          additions: 13,
          deletions: 2,
          patch: `@@ -61,6 +61,17 @@ def test_make_dummy_even_tokens():
     assert batch.seq_lens == [4, 4]
 
+@pytest.mark.parametrize(
+    "num_tokens,num_seqs,expected",
+    [
+        (10, 3, [3, 3, 4]),
+        (7, 2, [3, 4]),
+        (3, 1, [3]),
+    ],
+)
+def test_make_dummy_preserves_remainder(num_tokens, num_seqs, expected):
+    batch = AscendInputBatch.make_dummy(num_tokens, num_seqs)
+    assert batch.seq_lens == expected
+    assert sum(batch.seq_lens) == num_tokens
`,
        },
      ],
    },
  },
  {
    id: "vllm-ascend:issue:9821",
    repoId: "vllm-ascend",
    kind: "issue",
    number: 9821,
    state: "open",
    title: "Qwen3-235B throughput regression after CANN 8.3 update",
    author: "perf-team",
    bodyMd: `## Environment

- Device: Ascend A3
- Model: Qwen3-235B-A22B
- Parallelism: TP=8, EP=8
- Baseline: CANN 8.2
- Regressed: CANN 8.3

## Observation

Decode throughput drops by **12–16%** after the CANN upgrade. Prefill throughput remains within the expected noise range.

## Requested evidence

1. Per-layer profiler comparison.
2. HCCL All-to-All duration.
3. Grouped MatMul kernel selection.
4. A 30-minute stability run.`,
    comments: 24,
    domain: "FusedMoE",
    aiSummary:
      "CANN 8.3 后 Qwen3-235B decode 吞吐下降，信号指向 FusedMoE 通信或算子选择，需要逐层 profiler 对比。",
    statusText: "Needs investigation",
    important: 1,
    updatedAt: "2026-07-30T00:10:00.000Z",
  },
  {
    id: "vllm:pr:25826",
    repoId: "vllm",
    kind: "pr",
    number: 25826,
    state: "merged",
    title: "Refactor collective RPC lifecycle in multiprocess executor",
    author: "michael-vllm",
    bodyMd: `## Summary

Unifies creation, startup, shutdown, and abnormal-exit cleanup for collective RPC resources in the multiprocess executor.

## Compatibility

Device plugins that wrap worker startup or provide a custom communicator should verify hook ordering and exception cleanup.`,
    comments: 26,
    domain: "Distributed",
    aiSummary:
      "统一多进程 executor 的 collective RPC 生命周期，Ascend 自定义 worker wrapper 需要检查初始化顺序兼容性。",
    statusText: "Merged",
    important: 0,
    updatedAt: "2026-07-29T20:00:00.000Z",
    diff: {
      files: 2,
      additions: 54,
      deletions: 33,
      entries: [
        {
          path: "vllm/executor/multiproc_executor.py",
          additions: 32,
          deletions: 21,
          patch: `@@ -205,15 +205,26 @@ class MultiprocExecutor:
-        self.rpc = CollectiveRPC(self.workers)
-        self.rpc.start()
+        self.rpc_lifecycle = CollectiveRPCLifecycle(self.workers)
+        self.rpc_lifecycle.start()
 
     def shutdown(self):
-        if self.rpc:
-            self.rpc.close()
+        if self.rpc_lifecycle:
+            self.rpc_lifecycle.shutdown()
`,
        },
        {
          path: "vllm/distributed/rpc/lifecycle.py",
          additions: 22,
          deletions: 12,
          patch: `@@ -0,0 +1,22 @@
+class CollectiveRPCLifecycle:
+    def __init__(self, workers):
+        self.workers = workers
+        self.started = False
+
+    def start(self):
+        self._create_communicators()
+        self.started = True
+
+    def shutdown(self):
+        if not self.started:
+            return
+        self._close_communicators()
+        self.started = False
`,
        },
      ],
    },
  },
  {
    id: "vllm:issue:21408",
    repoId: "vllm",
    kind: "issue",
    number: 21408,
    state: "open",
    title: "RFC: Unify device plugin capability discovery",
    author: "platform-team",
    bodyMd: `# RFC: Device capability registry

The current platform API mixes single boolean capabilities with behavior-specific checks spread across attention, quantization, and workers.

This RFC proposes a typed registry with:

- composable capabilities;
- explicit versioning;
- plugin-owned validation;
- discoverable fallback behavior.

Device plugin maintainers are invited to document combination requirements before the interface is finalized.`,
    comments: 38,
    domain: "Model Runner",
    aiSummary:
      "RFC 计划统一设备能力声明入口，Ascend 应提前盘点 attention、quantization 与 worker 中的分散判断。",
    statusText: "Discussion",
    important: 1,
    updatedAt: "2026-07-29T18:00:00.000Z",
  },
];

export const SEED_ANALYSES = [
  {
    id: "insight-2026-07-30",
    type: "insight",
    scope: "all",
    title: "跨仓库 AI 洞察 · 2026-07-30",
    summaryMd:
      "今天的关键不是单一 PR，而是 **FusedMoE 性能回归、MRV2 输入语义、RPC 生命周期** 三条信号之间的关联。",
    contentMd: `# 跨仓库 AI 洞察

> 范围：vLLM 与 vLLM-Ascend · 过去 24 小时  
> 生成时间：2026-07-30 08:30 Asia/Shanghai

## 执行摘要

今天的关键不是单一 PR，而是三个可能互相放大的变化：

1. **Qwen3-235B decode 吞吐回归**：CANN 8.3 后下降 12–16%。
2. **MRV2 输入语义修复**：dummy batch 与真实调度 batch 的形状语义此前不一致。
3. **上游 Collective RPC 生命周期重构**：可能改变 Ascend worker wrapper 与 HCCL communicator 的初始化顺序。

## 重点洞察

### P0 · FusedMoE 回归应先拆分“通信”与“算子选择”

当前证据同时指向 HCCL All-to-All 和 Grouped MatMul。仅比较端到端吞吐无法归因，建议先完成：

- CANN 8.2 / 8.3 逐层 profiler 对比；
- All-to-All 时间占比和消息尺寸分布；
- Grouped MatMul 实际 kernel 选择；
- 30 分钟长稳曲线。

**证据来源**

- vllm-ascend#9821
- vllm-ascend#13094
- FusedMoE 技术领域快照

### P1 · MRV2 的稳定性边界正在收敛到 InputBatch

dummy input、TP token 分布和 graph replay 连续出现相关修复，说明需要把它们合并为同一测试矩阵，而不是分别补测试。

### P1 · RPC 生命周期与现有多机启动问题可能相关

上游的新生命周期对象收敛了启动和异常退出路径。Ascend 侧应按正常退出、worker 异常、communicator 创建失败三条路径核对 hook 顺序。

## 建议动作

| 优先级 | 动作 | 预期结果 |
| --- | --- | --- |
| P0 | 补齐 CANN 8.2 / 8.3 profiler | 判断回归属于通信还是算子 |
| P1 | 合并 MRV2 输入与 graph replay 测试矩阵 | 避免形状语义再次漂移 |
| P1 | 画出 RPC/HCCL 初始化时序 | 判断是否需要 Ascend 适配 |

## 不确定性

- 当前 profiler 数据尚未上传，FusedMoE 归因可信度为中高。
- RFC 类 Issue 尚未形成最终 API，能力注册影响仍需人工确认。`,
    prompt:
      "综合分析两个仓库的 PR、Issue、关注列表、跨仓库影响和技术领域变化，输出证据、风险和下一步动作。",
    model: "seed",
    refs: ["vllm-ascend#9821", "vllm-ascend#13123", "vllm#25826"],
  },
  {
    id: "daily-vllm-ascend-2026-07-30",
    type: "daily",
    scope: "vllm-ascend",
    title: "vLLM-Ascend 每日分析 · 2026-07-30",
    summaryMd: "变化集中在 **FusedMoE 性能** 与 **Model Runner V2 稳定性**。",
    contentMd: `# vLLM-Ascend 每日分析

## 今日判断

社区变化集中在 **FusedMoE 性能** 与 **Model Runner V2 稳定性**。建议优先跟进 CANN 8.3 回归，并在上游能力注册 RFC 中补充 NPU 组合能力诉求。

## 重要变化

- MRV2 dummy token 分布修复进入 Review。
- A3 Expert Parallel All-to-All 进入主线。
- CANN 8.3 decode 吞吐回归等待 profiler。

## 风险

1. 输入语义与图捕获形状不一致。
2. 上游 RPC 生命周期改变 Ascend hook 顺序。
3. 能力注册 RFC 可能要求迁移分散的平台判断。

## 今日建议

- 先补齐性能证据，再决定是否回退 CANN 或调整算子。
- 把 MRV2 多卡场景加入阻断性回归测试。
- 在 RFC 进入实现前提交 Ascend 能力清单。`,
    prompt: "分析过去 24 小时 vLLM-Ascend 的重要变化、风险和建议。",
    model: "seed",
    refs: ["vllm-ascend#9821", "vllm-ascend#13123"],
  },
];

export const SEED_TECHNICAL_DOCUMENTS = [
  {
    id: "doc-fused-moe-architecture",
    category: "FusedMoE",
    slug: "fused-moe-architecture-and-ascend-adaptation",
    title: "FusedMoE 架构与 Ascend 适配入口",
    summary: "从路由、Expert Dispatch、Grouped MatMul 到 EP 通信的代码导航。",
    tags: ["MoE", "Expert Parallel", "All-to-All", "A3"],
    refs: ["vllm/model_executor/layers/fused_moe/", "vllm_ascend/ops/fused_moe/"],
    contentMd: `# FusedMoE 架构与 Ascend 适配入口

## 1. 执行链

\`\`\`text
Model Execute
  └─ Router
      └─ Expert Dispatch
          ├─ All-to-All / AllGather
          └─ Grouped MatMul
\`\`\`

## 2. vLLM 上游核心

- \`vllm/model_executor/layers/fused_moe/\`
- \`FusedMoE\`
- \`FusedMoEMethodBase\`

## 3. Ascend 适配层

- \`vllm_ascend/ops/fused_moe/\`
- \`vllm_ascend/distributed/\`
- 设备侧算子选择、HCCL 通信和 A2/A3 能力差异

## 4. 验证入口

- correctness：不同 top-k、不同 expert 数和不同 dtype；
- distributed：TP/EP 组合与多机；
- performance：prefill/decode 分离统计；
- stability：长稳和异常退出资源回收。

## 5. 维护提示

领域地图记录“最近变化”，本文档记录长期有效的架构知识。PR 合入后应更新路径、关键符号和兼容性说明。`,
  },
  {
    id: "doc-mrv2-input-batch",
    category: "Model Runner",
    slug: "mrv2-input-batch-and-graph-replay",
    title: "MRV2 InputBatch、Dummy Input 与 Graph Replay",
    summary: "解释输入批处理如何影响图捕获、重放和多卡 token 分布。",
    tags: ["MRV2", "InputBatch", "ACLGraph", "Tensor Parallel"],
    refs: ["vllm/v1/worker/", "vllm_ascend/worker/v2/"],
    contentMd: `# MRV2 InputBatch、Dummy Input 与 Graph Replay

## 核心约束

Dummy input 必须与真实 scheduler batch 保持相同的：

- token 总数；
- sequence 分布；
- block table 形状；
- tensor parallel 切分语义。

## 为什么重要

图捕获阶段记录的是张量形状和执行路径。若 dummy batch 与真实 batch 的 remainder 分配不同，重放阶段可能触发错误形状或错误的缓存复用。

## 建议测试矩阵

| 维度 | 取值 |
| --- | --- |
| 设备 | 单卡 / TP / 多机 |
| token remainder | 0 / 1 / 大于 1 |
| graph | eager / capture / replay |
| batch | prefill / decode / mixed |
`,
  },
  {
    id: "doc-ci-cache-provenance",
    category: "CI / Infra",
    slug: "csrc-cache-provenance",
    title: "CSRC 缓存键、压缩元数据与构建来源",
    summary: "说明为什么可见缓存键一致仍可能 miss，以及如何追踪来源。",
    tags: ["CI", "Cache", "zstd", "BuildKit"],
    refs: [".github/workflows/", "docker/"],
    contentMd: `# CSRC 缓存来源与兼容性

## 两类缓存

1. GitHub Actions archive cache：保存 CSRC 编译产物。
2. BuildKit registry cache：保存镜像层。

两者是独立系统，不能因为镜像层命中就推断 CSRC archive 命中。

## 常见误判

相同的可见 key 仍可能因为压缩工具或元数据不兼容而 miss。所有独立 cache job 都应在 restore/save 之前准备相同的 zstd 能力。
`,
  },
];
