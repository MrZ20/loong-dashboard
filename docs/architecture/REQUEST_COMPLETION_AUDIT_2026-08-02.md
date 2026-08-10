# 近期功能请求完成审计

审计日期：2026-08-02（Asia/Shanghai）

本次为避免“七条请求”的计数边界产生遗漏，同时审计了摘要/深度分析附件请求、其后的七组功能请求以及最终重构要求。验收标准不是页面上是否出现按钮，而是同时核对数据字段、服务端行为、前端入口、持久化和自动化测试。

## 完成矩阵

| 请求 | 状态 | 主要实现与证据 |
| --- | --- | --- |
| PR/Issue 摘要与深度分析质量 | 已完成 | `analysis-quality.ts` 定义四套独立 v2 契约、输入与结构化输出；绑定 SHA/Hash/Prompt 版本，校验文件引用与证据完整性；`ai.ts` 负责一次结构纠错重试和旧版本隔离 |
| OpenCode、本地仓库、Session 与事件 | 已完成 | Local Runner、集中式 OpenCode Adapter、detached Worktree、Session binding、结构化事件、取消/超时/离线、代码引用校验均已接入；深度分析、显式本地洞察和仓库对话复用同一任务链 |
| D1 ambiguous `id` 与 GitHub 403/Token | 已完成 | 摘要候选查询全部限定表别名；每账户 GitHub Token 加密保存、测试、删除且不回显；403 错误区分匿名/认证额度并保留成功水位 |
| 技术领域架构地图与每日变化 | 本轮补齐 | 原实现仍只识别旧 6 个 `domain`，新版 taxonomy 的多数变更无法进入地图。本轮建立 15 个稳定架构领域与两套 taxonomy ID 的显式映射，修复 7 日活动、北京时间今日事件、快照上下文和页面分类映射展示 |
| PR/Issue 两种排序 | 已完成 | 列表支持 `updated` 最近更新和 `number` 编号倒序，切换只作用于当前数据库结果，不触发刷新 |
| 双仓库独立技术分类与标准刷新 | 已完成 | 两仓库独立类别文件、动态 Prompt、路径/CODEOWNERS/测试/Label 证据优先级、低置信度与候选分数、D1 taxonomy overlay 和设置页“更新分类标准”入口均已实现 |
| Prompt 统一管理 | 已完成 | 14 个可配置 AI 功能全部注册在 Prompt Catalog；页面只提供执行或跳转设置，不再散落可编辑 Prompt；内置契约只读，自定义模板可新增、复制、编辑、删除和启用 |
| 架构重构与过期清理 | 已完成 | Worker 已分层为 routes/services/repositories/integrations/domain；移除旧同步入口、详情隐式统计、旧单仓库分类器和演示数据；初始 D1 schema 不再建立废弃表；功能状态文档已同步更新 |

## 本轮修复的领域映射缺口

技术分类输出是仓库专属名称，而领域地图是跨仓库架构视角，二者不能再依靠名称相等。例如：

```text
vLLM: Engine & Model Runner
        ↕ 领域映射：Model Runner
vLLM-Ascend: Worker & Graph / XLite
```

本轮在 `architecture-catalog.ts` 中以 taxonomy category ID 建立映射，运行时从注册 taxonomy 解析名称，避免类别重命名再次静默丢失数据。所有非兜底类别必须恰好进入一个架构领域；新增分类若没有更新地图，契约测试会失败。

该映射同时用于：

1. 技术领域地图近 7 日 PR/Issue/重点数量；
2. 北京时间今日事件与修改路径覆盖层；
3. AI 架构快照的双仓库分类上下文；
4. vLLM 到 vLLM-Ascend 的跨仓影响候选关联。

调试阶段不保留旧分类别名；清空本地数据后直接按当前 taxonomy 重新生成。

## OpenCode 当前版本核对

本机 OpenCode 为 `1.18.11`。本轮临时启动仅绑定 `127.0.0.1` 的 Server 并读取 `/doc`，确认当前 Adapter 使用的健康检查、Provider、Session 创建、消息历史、`prompt_async`、事件流和取消端点仍存在，请求字段与本地实现一致。Server 已在核对后停止。

## 自动化约束

新增或保留的关键回归场景包括：

- 打开详情不刷新，四类手动任务互不触发；
- 时间戳边界不遗漏，失败不推进水位；
- 相同摘要版本不重复分析，旧 SHA 不能成为当前结果；
- 两套 taxonomy 独立、测试映射回源码域、CODEOWNERS 最具体匹配；
- 每个非兜底分类恰好映射一个架构领域；
- 不同名称的上游/Ascend 分类可以进入同一跨仓架构域；
- 普通聊天不启动 OpenCode，仓库模式复用 Session；
- Worktree detached、Head 变化不复用、只读权限和代码引用校验；
- GitHub Token 账户隔离、加密且 API 只返回状态。

验证命令：

```bash
cd frontend
npm run typecheck
npm run test:sites
git diff --check
```

本轮结果：生产构建成功，81 项测试全部通过，`git diff --check` 通过；本机既有 `localhost:4174` 服务的 `/api/health` 返回数据库正常，首页返回 `200 text/html`。构建仅保留 Vite 的大 chunk 性能提示，不影响功能正确性。

真实模型生成质量仍取决于用户配置的 Provider/Model；未配置模型时系统会明确失败或降级，不会把规则文本伪装成模型分析。
