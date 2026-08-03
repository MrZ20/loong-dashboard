# LoongBoard 现有架构审计与重构方案

## 目标

本轮重构不改变看板的信息架构，也不新增产品能力。目标是让现有功能按稳定边界继续演进：

```text
Vue 页面
  → composables / feature API
  → Worker routes
  → services
  → repositories / integrations
  → D1 / GitHub / OpenCode Runner
```

列表和详情仍只读取 D1；GitHub 事实、AI 摘要、分类和深度分析继续作为四个互不隐式触发的任务运行。

## 审计结论

1. `worker/settings.ts` 同时包含 HTTP、认证、校验、加密、业务编排和 SQL，是最明显的后端职责泄漏点。
2. 原 `worker/domains.ts` 同时查询 D1、拼装领域模型、调用 AI 并写入快照，无法独立测试纯架构文档与持久化。
3. 旧 `/api/repositories/:repo/sync` 已没有前端调用者，只是把请求转发给新的 facts 任务；它与明确的四类刷新 API 重复。
4. `ensurePullStats` 和 `detectDomain` 没有生产调用者。前者会绕过“详情只读”和显式刷新约束，后者将仓库固定为 vLLM-Ascend，已经不适合双仓库分类。
5. `src/data/community.ts` 与 `src/data/workspace.ts` 保存整套早期演示 PR、Issue、洞察和领域地图。生产页面已从 API 读取数据，但筛选项和关注元数据仍引用这些文件，可能把演示结论带入真实账户。
6. 分类刷新服务仍直接写 SQL；设置页虽已拆出部分子路由，账户和 AI Provider 仍留在单体入口。
7. `worker-logic.test.mjs` 中存在只为已退出生产流程的 `detectDomain` 兼容函数服务的测试，且 Sites 打包测试没有约束最新迁移。

## 已执行的结构调整

### 设置域

- `routes/settings-account.ts` 与 `routes/settings-ai.ts` 只处理 HTTP、认证和输入校验。
- `services/account-settings.ts` 与 `services/ai-provider-settings.ts` 负责账户和 Provider 工作流。
- `repositories/accounts.ts` 与 `repositories/ai-providers.ts` 集中 D1 查询。
- `worker/settings.ts` 仅保留设置子路由分发。

### 领域地图

- `domain/architecture-catalog.ts` 保存稳定架构基线，不再把正式领域配置放在 demo seed 文件中。
- `domain/domain-map.ts` 负责纯文档和结构模型生成。
- `repositories/domain-maps.ts` 负责活动、事件和快照 SQL。
- `services/domain-maps.ts` 负责读取证据、调用 AI 和保存快照。

### 社区事实与分类

- Review 判定移动到 `domain/review-signals.ts`。
- 非 AI 摘要回退移动到 `domain/community-summary.ts`。
- 分类候选读取与结果写入移动到 `repositories/classifications.ts`。
- `worker/github.ts` 继续作为兼容 facade，但只导出仍有调用价值的能力。

### 前端真实数据

- 删除早期静态 PR、Issue、洞察、跨仓库影响和领域地图数据。
- 技术领域筛选项由当前仓库实际 D1 数据生成。
- 关注列表元数据使用 `/api/watchlist` 返回的账户数据，不再读取硬编码样例。
- `communityItemKey` 作为纯领域工具移动到 `src/domain/community-item.ts`。

## 删除清单

- 删除旧 `/api/repositories/:repo/sync` 路由和客户端方法。
- 删除无调用的 `repository-sync.ts`、`ensurePullStats` 和 `detectDomain`。
- 删除 `src/data/community.ts`、`src/data/workspace.ts` 两个演示数据模块。
- 通过 D1 migration `0013_remove_legacy_sync_runs.sql` 删除只服务旧同步入口的 `sync_runs` 表。
- 将旧 `detectDomain` 测试改为直接验证双仓库分类器，不再维护错误的单仓库默认行为。

## 保留的兼容边界

- `worker/github.ts` 和 `src/api/client.ts` 保留为稳定导入 facade。
- 现有四类刷新、Prompt 中心、GitHub Token、本地 Runner、OpenCode Session、列表和详情响应结构保持不变。
- 历史 D1 migration 不修改；结构清理由新增 migration 完成。

## 后续建议

`SettingsView.vue`、`local-analysis.ts` 和 `worker-logic.test.mjs` 仍然较大，但当前分别是单个完整工作区、单个 Runner 编排域和统一契约测试入口。后续应在出现第二个独立消费者时按功能拆分，避免仅为了行数制造无复用组件。本轮优先消除了会造成错误副作用、假数据和双入口的结构问题。
