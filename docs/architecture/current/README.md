# LoongBoard 当前实现说明

本目录只描述当前代码已经实现的行为，不记录未来规划。文档按“用户在哪个页面做什么”组织，再由页面链接到对应的端到端流程。阅读时不需要先理解 Vue、Worker 或 D1 的技术分层。

## 从页面开始阅读

| 页面或入口 | 用户看到的功能 | 详细说明 |
| --- | --- | --- |
| vLLM / vLLM-Ascend 仓库页 | PR、Issue、筛选、分页、刷新状态、详情 | [仓库社区页](pages/01-repository-community.md) |
| AI 洞察 | 跨仓库报告、每日分析、本地代码证据 | [AI 洞察页](pages/02-ai-insights.md) |
| 关注列表 / 跨仓库影响 | 个人关注项、上下游适配关系 | [关注与跨仓库页面](pages/03-watchlist-and-cross-repo.md) |
| 技术领域地图 / 技术文档 | 架构基线、每日变化、Markdown 知识库 | [技术知识页面](pages/04-domain-map-and-documents.md) |
| AI 对话 / 悬浮助手 | 普通问答、仓库问答、多会话和滑词上下文 | [AI 对话页](pages/05-ai-chat.md) |
| 设置 | 账户、GitHub Token、AI 配置、提示词、刷新和 Runner | [设置页](pages/06-settings.md) |

## 按关键流程查细节

| 想知道的问题 | 文档 |
| --- | --- |
| vLLM-Ascend 的 PR 是怎样从 GitHub 进入列表的？为什么不会重复？ | [PR/Issue 社区事实刷新](flows/01-community-facts-refresh.md) |
| 摘要、分类和深度分析各自何时运行？为什么互不触发？ | [摘要、分类与深度分析](flows/02-summary-classification-deep-analysis.md) |
| API Token 保存在哪里？任务怎样选择 API、OpenCode 或 Codex？ | [AI 配置、提示词与凭据](flows/03-ai-config-prompt-token.md) |
| 本地 Agent 如何领取任务、准备仓库、建立 Session 并回传事件？ | [本地 Agent 任务生命周期](flows/04-local-agent-execution.md) |
| 各种状态、版本字段、错误和过期标记如何流转？ | [状态、版本与失败恢复](flows/05-state-version-error.md) |

## 系统与运维参考

- [运行时拓扑与边界](system/01-runtime-topology.md)
- [D1 数据域与安全边界](system/02-data-and-security.md)
- [部署、调试与测试](operations/01-deployment-testing.md)

## 贯穿全部功能的约束

1. 打开列表或详情只读取 D1，不会隐式访问 GitHub、调用 AI、重新分类或准备本地仓库。
2. “社区事实、摘要分析、分类标签、深度分析”是四类独立任务；一个按钮只触发一类。
3. AI 业务任务先解析任务配置，再选择 API、OpenCode 或 Codex；执行引擎不能改变业务语义。
4. GitHub Token、AI Token、Runner Token、本地路径和本地引擎认证信息不返回浏览器明文。
5. 所有 AI 结果保存 Prompt、模型、Provider 和输入版本；本地代码结论还必须保存 Commit 与代码引用。

## 文档维护规则

新增页面时先增加 `pages/` 文档；新增跨页面业务链路时增加 `flows/` 文档；只有运行时拓扑、数据边界或部署方式变化时才修改 `system/` 或 `operations/`。每份文档中的“代码入口”必须指向真实文件，不能只写抽象组件名。
