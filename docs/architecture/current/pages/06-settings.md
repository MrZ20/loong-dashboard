# 设置页：账户、Token、AI 管理、刷新与本地运行环境

设置页不是单纯表单集合。它分别管理云端账户数据、D1 中的加密配置、业务任务绑定，以及只存在本机的 Runner 能力。

## 页面分区

| 一级区域 | 二级区域 | 保存位置 |
| --- | --- | --- |
| 账户与登录 | 资料、账户切换 | D1 用户与 Profile |
| AI 管理 | AI 任务、AI 配置、本地运行环境 | D1 任务/Provider/Prompt + 本机 Runner |
| 社区数据刷新 | GitHub Token、四类刷新配置 | D1 加密凭据与刷新配置 |

前端主入口为 `frontend/src/components/SettingsView.vue`，具体表单拆在 `frontend/src/components/settings/`。

## AI 配置

“AI 配置”保存可调用 OpenAI-compatible 接口的账户配置：

- 名称；
- Base URL；
- 接口模式：Responses 或 Chat Completions；
- Model；
- API Token。

Token 提交到 Worker 后加密写入 `ai_providers.encrypted_token`。再次打开页面只返回 `tokenConfigured` 和末四位提示。环境变量配置是只读内置项，不能在页面删除。

删除自定义 AI 配置前会统计 `ai_task_bindings`；仍有任务引用时返回 409，要求先切换这些任务。

## AI 任务

AI 任务按业务分组，而不是把所有 Prompt 平铺：

- vLLM：PR/Issue 摘要、深度分析、分类补判、分类标准更新、今日分析；
- vLLM-Ascend：相同功能，但使用独立任务键和 Prompt；
- AI 洞察；
- 技术知识；
- AI 对话。

选中一个任务后，保存以下完整绑定：

```text
任务键
  → API / OpenCode / Codex
  → API 配置，或本地 Provider + Model + 推理强度
  → Prompt 模板
  → 无源码 / 临时 Worktree / 会话 Worktree
  → 使用本地 / 安全 Fetch
  → 安全只读 / 社区检索 / 隔离开发
```

API 模式会强制工作区为 `none`、更新为 `none`、权限为 `safe_readonly`。本地模式保存的能力必须同时被该引擎和在线 Runner 支持。

“测试当前组合”不是执行正式业务任务：API 模式发送最小连通性请求；本地模式检查 Runner、引擎、Provider/Model 和权限可用性。测试成功或失败会更新该任务最近状态；历史错误可以单独清除。

## Prompt 管理

每个业务任务只能选择属于其 `featureKey` 的 Prompt。系统默认模板只读；用户模板支持新增、复制、编辑、删除和启用。保存任务时记录模板 ID，执行时再解析当前 Revision，并把 Prompt 名称、版本和 Revision 快照写入结果。

分类 Prompt 由仓库 taxonomy 动态生成系统约束，用户模板只补充该功能的评判偏好；AI 不能创建未注册类别。

## GitHub Token 与刷新额度

GitHub Token 保存到 `github_credentials` 的加密字段。验证动作并行调用 `/user` 和 `/rate_limit`，页面分别显示 REST Core 与 GraphQL 额度、重置时间和验证账号。

事实批量刷新需要 Token 才能使用 GraphQL 批量 PR 快照；没有 Token 时会明确拒绝，而不是退化为几十个匿名逐条请求。

## 社区数据刷新

vLLM 与 vLLM-Ascend 的四类任务配置互相独立。每张卡显示：自动开关、周期、活跃范围、判定规则、过滤条件、上次成功、下次计划、状态、待处理数和最近错误。

保存配置只更新 `refresh_task_configs`，不会立即执行；“手动刷新”才创建运行记录。深度分析不提供定时开关。

## 本地运行环境

本地区域展示 Runner 心跳、OpenCode/Codex 健康与认证、Provider/Model 目录、仓库状态和只读能力。路径、密码和认证值仍只保存在 `.loongboard/runner.json` 或引擎本机配置中。

操作包括：连接测试、仓库检查、缺失仓库 Clone、刷新 Provider/Model、清理过期 Worktree。页面提交的是 Runner Action Job，实际 Git/本地服务操作仍由 Runner 完成。

进一步阅读：

- [AI 配置、提示词与凭据](../flows/03-ai-config-prompt-token.md)
- [本地 Agent 任务生命周期](../flows/04-local-agent-execution.md)
- [PR/Issue 社区事实刷新](../flows/01-community-facts-refresh.md)
