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
7. `worker-logic.test.mjs` 中曾存在只为已退出生产流程的 `detectDomain` 服务的测试，且 Sites 打包测试没有约束最新迁移。

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
- GitHub 调用方直接依赖 `integrations/github/` 下的边界模块，不再经过聚合 facade。

### 前端真实数据

- 删除早期静态 PR、Issue、洞察、跨仓库影响和领域地图数据。
- 技术领域筛选项由当前仓库实际 D1 数据生成。
- 关注列表元数据使用 `/api/watchlist` 返回的账户数据，不再读取硬编码样例。
- `communityItemKey` 作为纯领域工具移动到 `src/domain/community-item.ts`。

## 删除清单

- 删除旧 `/api/repositories/:repo/sync` 路由和客户端方法。
- 删除无调用的 `repository-sync.ts`、`ensurePullStats` 和 `detectDomain`。
- 删除 `src/data/community.ts`、`src/data/workspace.ts` 两个演示数据模块。
- 初始 D1 schema 不再创建已废弃的 `sync_runs` 表。
- 将旧 `detectDomain` 测试改为直接验证双仓库分类器，不再维护错误的单仓库默认行为。

## 直接边界

- 前端直接导入具体 API 和领域类型模块，不再保留 `src/api/client.ts` 或 `src/types.ts` 聚合入口。
- Worker 直接导入具体 route、service、repository 和 integration，不再保留 GitHub 或 Local Agent 转发 facade。
- Local Agent 任务和 Session 只使用通用 engine 协议；OpenCode 和 Codex 是可替换 Adapter，不向业务层暴露专属历史字段。
- 调试阶段数据库从空 schema 开始，过期数据回填和旧结构迁移不再保留。

## 后续建议

Local Agent 已按入队、会话、聊天、洞察、完成回调和映射职责拆分；Runner 也已分成引擎 Registry、Adapter、Worktree 与任务编排。后续新增引擎时实现统一 Adapter 契约并注册即可，不修改 PR/Issue、洞察或对话业务流程。
