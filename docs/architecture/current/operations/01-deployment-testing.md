# 部署、调试与测试

## 默认本地目录

```text
workspace/
├── loong-dashboard/
├── vllm/
└── vllm-ascend/
```

Runner 示例默认使用 `../vllm` 和 `../vllm-ascend`，可在 `.loongboard/runner.json` 覆盖。实际路径和本地密码不提交 Git。

## 本地启动顺序

```bash
cd frontend
npm install
npm run db:migrate:local
npm run dev:service
```

另一个终端：

```bash
cd frontend
npm run runner
```

`dev:service` 会先构建前端，再用 `wrangler.local.toml` 启动本地 Worker/D1 服务，默认监听 4174。启动器同时打开 Wrangler 的 scheduled 测试入口：Worker 健康后立即扫描一次到期任务，之后每 15 分钟扫描一次。生产部署仍由 Cloudflare Cron 调用同一个 `scheduled` Handler，不使用本地启动器。Runner 从 `.loongboard/runner.json` 读取 Worker 地址、Token、仓库和引擎配置。

本地自动刷新依赖 `dev:service` 进程持续运行；单独打开网页不会产生 scheduled 事件。调度是否工作应以 `refresh_task_runs.trigger_type = 'scheduled'` 和任务的 `last_attempted_at/last_successful_at` 为准，而不是仅检查开关状态。

## Runner 初始配置

从 `frontend/local-runner/runner.example.json` 创建本机配置，至少确认：

- `dashboardUrl`；
- `runnerToken` 与 Worker `LOCAL_RUNNER_TOKEN` 一致；
- 两个仓库的 path 与 cloneUrl；
- scratch/worktree 根目录；
- `allowedPermissionProfiles`；
- OpenCode/Codex 是否启用；
- 最大并发、会话 Worktree 保留时间、自动 Fetch 和超时；临时 Worktree 不受保留时间影响，任务结束立即清理。

OpenCode Server 默认只监听 `127.0.0.1`。Codex App Server 使用本机已有登录。云端部署时仍由 Runner 主动领取任务，不暴露本地引擎端口。

## 页面上的运维动作

“设置 → AI 管理 → 本地运行环境”提供：

- Runner/引擎连接检查；
- 仓库存在性与 Git 状态检查；
- 缺失仓库初始化 Clone；
- Provider/Model 目录刷新；
- 过期 Worktree 清理。

这些操作进入 `local_analysis_jobs` 的 action 类型，Runner 执行后上传事件。已存在仓库的初始化操作只做安全 Fetch，不切换用户日常分支。

## 标准验证

```bash
cd frontend
npm run typecheck
npm run build
node --test tests/*.test.mjs
git diff --check
```

主要测试域：

| 测试文件 | 覆盖内容 |
| --- | --- |
| `worker-logic.test.mjs` | 刷新水位、摘要版本、分类、AI 任务和路由逻辑 |
| `local-runner.test.mjs` | 仓库/Worktree、事件、权限、Session 和恢复 |
| `local-engine-adapters.test.mjs` | OpenCode/Codex Adapter 合约 |
| `ai-execution-ui.test.mjs` | AI 设置界面与执行策略展示 |
| `community-pagination.test.mjs` | 100 条分页与全局序号 |
| `refresh-handlers.test.mjs` | 四类 Handler 独立性 |
| `architecture-contracts.test.mjs` | 文件分层和架构边界 |

静态测试只能证明代码、类型、构建和纯逻辑，不证明真实 GitHub 额度、外部模型质量、NPU 运行时或本机 OpenCode/Codex 登录。涉及这些能力时需要单独做真实连通性或设备验证。

## 常用问题定位

### 页面可打开但数据不更新

检查浏览器请求、Worker 日志、`refresh_task_runs` 和 GitHub 额度。列表只读 D1，页面刷新不等于 GitHub 刷新。

### Runner 显示离线

检查 Runner 进程、`dashboardUrl`、Token 一致性，以及 `/api/local-runner/heartbeat`。不要尝试让浏览器直连 OpenCode。

### 本地任务一直运行

检查 `local_analysis_events` 最后阶段、模型超时、是否收到取消、以及前端轮询是否仍在 15 分钟任务窗口内。

### Worktree 占用增长

Worktree 主要占用磁盘而非内存。临时 Worktree 应在成功、失败或取消后自动消失；若仍有残留，优先检查 `worktree_cleanup` 事件。会话 Worktree 和进程异常留下的目录才按保留时间清理；不要手工删除用户主仓库。

## 扩展规则

- 新页面：增加 `pages/` 文档，列出用户动作、API、D1 和错误路径；
- 新业务流程：增加 `flows/` 文档，并链接页面入口；
- 新 AI 引擎：实现 Adapter 合约并声明能力；
- 新 AI 任务：注册任务键、默认策略、Prompt 功能和 completion handler；
- 新权限：同时定义工具、命令、支持引擎、工作区限制和 Runner allow-list；
- 新数据字段：添加新的 D1 Migration，不改写已发布迁移。
