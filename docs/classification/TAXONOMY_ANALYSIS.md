# PR / Issue 单一技术领域分类分析

分析日期：2026-08-02（Asia/Shanghai）

本文件是分类规则的证据快照，不是运行时 Prompt。运行时规则位于 `frontend/worker/domain/classification/taxonomies/`，分类 Prompt 由这些定义动态生成。

## 证据范围

### vLLM

- 本地仓库：`../vllm`
- 分析 Commit：`1f486d96a17303ce8db8e02be39545b2be338446`
- 读取：`.github/CODEOWNERS`、`vllm/`、`csrc/`、`rust/`、`tests/`、`pyproject.toml` pytest markers、`.buildkite/test_areas/`
- Buildkite 当前 31 个 test areas 包括 Attention、Compile、Distributed、Disaggregated、Kernels、LoRA、Model Runner V2、Spec Decode、Expert Parallelism、Quantization、Multimodal、Samplers、Rust Frontend、Weight Loading 等。它们用于证明真实覆盖面，不直接一对一转换成页面类别。
- GitHub Labels 中可稳定辅助分类的标签包括 `kv-connector`、`mrv2`、`multi-modality`、`quantization`、`speculative-decoding`、`structured-output`、`tool-calling`、`torch.compile`、`vllm-ir`、`rust`、`rocm`、`tpu` 等。
- 抽查近期 PR 文件：[#50698](https://github.com/vllm-project/vllm/pull/50698)、[#49069](https://github.com/vllm-project/vllm/pull/49069)、[#49077](https://github.com/vllm-project/vllm/pull/49077)、[#50465](https://github.com/vllm-project/vllm/pull/50465)、[#50697](https://github.com/vllm-project/vllm/pull/50697) 等。

### vLLM-Ascend

- 本地仓库：`../vllm-ascend`
- 分析 Commit：`3621965817a8e73f984fe3761c0389151a500902`
- 读取：`.github/CODEOWNERS`、`vllm_ascend/`、`csrc/`、`tests/`、`pyproject.toml` pytest markers、E2E coverage taxonomy 与 labeler 配置
- CODEOWNERS 直接区分 `attention`、`compilation`、`core`、`device`、`device_allocator`、`distributed`、`eplb`、`kv_offload`、`lora`、`model_loader`、`ops`、`patch`、`quantization`、`sample`、`spec_decode`、`worker`、`xlite`。
- E2E taxonomy 的 feature/arch/parallel/deploy/hardware/quantization/graph mode 用于把测试映射回技术域。例如 `eplb`/`dynamic_eplb` 映射 EPLB，`fa3`/`sfa_dsa` 映射 Attention，`aclgraph` 映射 Worker & Graph，`pd_disaggregation` 映射 Distributed & KV Transfer。
- GitHub Labels 中可辅助分类的标签包括 `module:core`、`module:dp`、`module:ep`、`module:graph`、`module:lora`、`module:multimodal`、`module:ops`、`module:quantization`、`aclgraph`、`eplb`、`kv-cache-pool`、`mtp/speculative-decode`、`pd-disaggregation` 等。
- 抽查近期 PR 文件：[#13328](https://github.com/vllm-project/vllm-ascend/pull/13328)、[#12831](https://github.com/vllm-project/vllm-ascend/pull/12831)、[#12852](https://github.com/vllm-project/vllm-ascend/pull/12852)、[#12804](https://github.com/vllm-project/vllm-ascend/pull/12804)、[#12453](https://github.com/vllm-project/vllm-ascend/pull/12453) 等。

## vLLM 主要技术领域

| 领域 | 职责 | 核心源码路径 | 测试映射 | 易混淆与选择规则 |
| --- | --- | --- | --- | --- |
| Attention | Attention backend、MLA/MHA、KV 读写 | `vllm/model_executor/layers/attention/`, `vllm/v1/attention/`, `csrc/attention/` | `tests/kernels/attention/`, `tests/v1/attention/` | 仅 KV 块管理归 Scheduler；通用 kernel 基础设施归 Compilation & Kernels |
| FusedMoE & Expert Parallelism | MoE 层、路由、专家并行与融合算子 | `vllm/model_executor/layers/fused_moe/`, `csrc/moe/` | MoE kernel/model/EP tests | 通用 collective/KV 传输归 Distributed |
| Scheduler & KV Cache | V1 调度、请求状态、Block/Cache 生命周期 | `vllm/v1/core/`, `vllm/config/cache.py` | `tests/v1/core/`, KV/prefix cache tests | KV Connector 与跨节点传输归 Distributed；Spec pipeline 归 Speculative Decoding |
| Distributed & KV Transfer | 并行状态、collective、KV Connector、PD 解耦 | `vllm/distributed/`, `vllm/v1/executor/` | distributed、disaggregated、KV connector tests | MoE 专属路由归 FusedMoE |
| Engine & Model Runner | Engine、Worker、GPU runner、InputBatch | `vllm/v1/engine/`, `vllm/v1/worker/`, `vllm/engine/` | engine/worker/MRV2 tests | 调度策略归 Scheduler；模型结构归 Model Support |
| Compilation & Kernels | torch.compile、IR、fusion、Triton/CUDA kernels | `vllm/compilation/`, `vllm/ir/`, `vllm/kernels/`, `csrc/` | compile、IR、通用 kernel tests | Attention/MoE 专属核心算子仍归对应技术域 |
| Quantization | 量化方法、低精度权重与参数 | `vllm/model_executor/layers/quantization/` | `tests/quantization/` | 仅模型注册/普通权重映射归 Model Support |
| Model Support & Weight Loading | 模型实现、注册、配置和权重装载 | `vllm/model_executor/models/`, `vllm/model_executor/model_loader/` | models、weight loading tests | 通用 Attention/MoE/Quantization 层优先于模型文件数量 |
| Multimodal | 图像/音频/视频输入、processor 与 registry | `vllm/multimodal/`, `vllm/inputs/` | multimodal/model multimodal tests | 仅 API 协议归 Serving；仅模型权重归 Model Support |
| Speculative Decoding | Draft/Target、proposal、accept/reject、MTP/EAGLE | `vllm/v1/spec_decode/`, `vllm/config/speculative.py` | spec decode tests | 通用 sampler 归 Sampling & Structured Output |
| LoRA | Adapter 装载、激活、多 LoRA 与融合层 | `vllm/lora/` | `tests/lora/` | 普通权重装载归 Model Support |
| Rust Frontend | Rust server、CLI、managed engine、parser 与 Engine Core client | `rust/` | Rust crate tests、Rust parser tests | Rust 路径优先；Python 协议文件仍按其实际源码域比较 |
| Serving & APIs | OpenAI/Anthropic/Pooling/Speech API、CLI | `vllm/entrypoints/`, `vllm/serve/` | entrypoint/serve tests | parser/grammar 核心归 Sampling & Structured Output |
| Sampling & Structured Output | Sampling、grammar、reasoning/tool parser、renderer | `vllm/v1/sample/`, `vllm/v1/structured_output/`, `vllm/reasoning/`, `vllm/tool_parsers/` | sampler、structured output、tool use tests | Spec 专属 sampler 归 Speculative Decoding |
| Platform & Hardware | CUDA/ROCm/CPU/XPU/TPU 平台与设备抽象 | `vllm/platforms/`, `vllm/device_allocator/` | platform/hardware tests | 通用 kernel 归 Compilation & Kernels |
| CI / Infra | Buildkite、Actions、Docker、构建发布 | `.buildkite/`, `.github/workflows/`, `docker/` | 不作为业务测试域 | 只在没有核心源码域时使用 |
| Documentation | 纯文档与指南 | `docs/` | 无 | 只在纯文档变更使用 |
| Tests | 无法映射的通用测试基础设施 | `tests/` | `tests/` | 任何可映射测试必须归具体技术域 |
| Other | 证据不足 | 无 | 无 | 模糊 Issue 保守使用 |

### vLLM 合并与新增判断

- 合并过细项：Buildkite 的 Models-Basic/Models-Language/Models-Distributed 统一落到 Model Support 或被实际源码域覆盖；CUDA/PyTorch/Kernels 的运行区域不直接变成三个页面领域；E2E Integration/Misc 不作为技术域。
- 当前系统此前未覆盖或覆盖不足的新领域：KV Transfer、Compilation/IR、LoRA、Speculative Decoding、Multimodal、Sampling/Structured Output、Rust Frontend；本次均已建立独立规则或明确合并边界。
- pytest markers 主要描述执行成本/平台/分布式属性，不直接作为 `domain`；`distributed` marker 只能辅助已出现的模块证据。

## vLLM-Ascend 主要技术领域

| 领域 | 职责 | 核心源码路径 | 测试/E2E 映射 | 易混淆与选择规则 |
| --- | --- | --- | --- | --- |
| Attention | Ascend Attention、MLA、CP、FA/FIA、KV 压缩 | `vllm_ascend/attention/`, `csrc/attention/` | fa3、fia、sfa_dsa、dsa_cp、long_sequence | 缓存生命周期归 Core；图执行归 Worker |
| FusedMoE & Custom Ops | MoE、路由、MC2/GMM、融合与 NPU custom op | `vllm_ascend/ops/`, `csrc/moe/`, `csrc/mc2/`, `csrc/gmm/` | moe、multistream_moe、routing replay | EPLB 策略归 EPLB；通用通信归 Distributed |
| Worker & Graph | Worker、V1/V2 runner、InputBatch、ACLGraph | `vllm_ascend/worker/` | aclgraph、sleep_wake、batch_invariant | Scheduler 状态归 Core；compile pass 归 Compilation |
| Core Scheduler & KV Cache | Core patch、Scheduler、Block/KV 管理、prefix cache | `vllm_ascend/core/`, `vllm_ascend/patch/core/` | prefix_caching、chunked_prefill | offload 介质归 KV Offload；跨节点 KV 归 Distributed |
| Distributed & KV Transfer | HCCL、KV Connector、PD/EPD、并行与跨实例通信 | `vllm_ascend/distributed/` | TP/PP/EP/DP/DCP/SP、pd_mix/pd_disaggregation/epd、flashcomm | EPLB 算法归 EPLB；加载期权重映射归 Model Loading |
| EPLB | 专家放置、动态负载均衡和重平衡 | `vllm_ascend/eplb/` | eplb、dynamic_eplb | 明确 EPLB 路径优先于通用 MoE/EP |
| KV Offload | KV 的 CPU/外部介质 offload 与搬运 | `vllm_ascend/kv_offload/`, `vllm_ascend/simple_kv_offload/` | cpu_offloading | Block 分配归 Core；KV 网络传输归 Distributed |
| Compilation | Ascend compile、fusion、图优化和缓存 | `vllm_ascend/compilation/` | compile_fusion | ACLGraph 运行生命周期归 Worker & Graph |
| Quantization | W8A8/FP8/INT4 等量化方法与参数 | `vllm_ascend/quantization/` | quantization | 仅量化模型权重映射归 Model Loading |
| Speculative Decoding | MTP/EAGLE proposer 与 accept/reject | `vllm_ascend/spec_decode/` | spec_decode、mtp、eagle3 | 通用 sampler 归 Sampling |
| Sampling | logits、sampling、guided decoding、logprobs | `vllm_ascend/sample/` | guided_decoding、logprobs | Spec 专属采样归 Speculative Decoding |
| LoRA | Ascend adapter、多 LoRA、动态加载 | `vllm_ascend/lora/` | lora、multi_lora、runtime_lora、fully_sharded_lora | 普通模型权重归 Model Loading |
| Model Loading & Weight Transfer | model loader、NetLoader/RFork、在线权重更新 | `vllm_ascend/model_loader/`, `vllm_ascend/distributed/weight_transfer/` | weight_transfer、cpu_weight_offload | 通用通信归 Distributed；模型结构归 Models |
| Device & Memory | NPU device、allocator、内存池、profiling | `vllm_ascend/device/`, `vllm_ascend/device_allocator/`, `vllm_ascend/profiler/` | profiling、sleep_wake | KV 专属 offload 归 KV Offload |
| XLite | XLite 独立执行后端与集成 | `vllm_ascend/xlite/` | xlite | 明确路径命中时优先 |
| Models & Multimodal | Ascend 模型 patch、架构与多模态适配 | `vllm_ascend/models/`, `vllm_ascend/patch/models/` | dense/moe/embedding/classification/reranker/mamba_ssm/multimodal | 通用层和加载机制由更具体领域覆盖 |
| Platform & Patches | Platform 注册、跨领域兼容 patch、310P 特化 | `vllm_ascend/platform.py`, `vllm_ascend/patch/`, `vllm_ascend/_310p/` | hardware taxonomy | 具体 worker/distributed patch 映射回对应域 |
| CI / Infra | Actions、Docker、构建、E2E taxonomy 基础设施 | `.github/workflows/`, `tests/e2e/`, `docker/` | 只有 taxonomy/框架本身 | E2E feature 可映射时不能归 CI |
| Documentation | 纯文档与部署指南 | `docs/` | 无 | 只在纯文档变更使用 |
| Tests | 无法映射的通用 fixture/harness | `tests/` | 无领域语义测试 | 最后兜底 |
| Other | 证据不足 | 无 | 无 | 模糊 Issue 低置信度使用 |

### vLLM-Ascend 合并与新增判断

- 合并过细项：E2E 的 arch、parallel、deploy、hardware、quantization、graph mode 是验证维度，不是额外输出维度；它们用于映射到上述主要技术域。
- 当前系统此前未覆盖或覆盖不足的新领域：EPLB、KV Offload、Compilation、Sampling、LoRA、Device & Memory、XLite、Model Loading & Weight Transfer、Platform & Patches。
- `ops/` 不能一律归 Platform/Hardware：MoE/MC2/GMM 的主要改动归 FusedMoE & Custom Ops；Attention 专属算子归 Attention；无法映射的通用 custom op 才保留在 FusedMoE & Custom Ops 的广义算子范围并降低置信度。

## 统一裁决规则

1. PR 先按核心源码修改行数比较，再比较强路径命中数、最具体 CODEOWNERS、源码与测试共同支持、标题目标。
2. 文档、测试、CI 数量不能覆盖明确核心源码；测试路径必须先尝试映射到具体技术域。
3. Issue 依次使用 Labels、正文明确路径/模块、关联 PR、标题、正文。只有现象描述时返回低置信度或 Other。
4. 候选接近时保留 `scores` 并降低 `confidence`；AI 只对低置信度规则结果补判，且只能选择已注册类别。
5. 分类标准刷新只允许给现有类别增加经过校验的仓库内路径/关键词/排除规则；新类别由 AI 形成建议，必须通过新增独立类别定义与测试后才能生效。
