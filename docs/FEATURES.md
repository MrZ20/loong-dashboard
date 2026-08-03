# LoongBoard 功能状态

本清单以 `frontend/` 中的可部署版本为准，更新于 2026-08-02。`[x]` 表示已有生产链路并纳入自动化验证，`[~]` 表示底层数据能力已存在但仍缺少完整产品入口。

## 社区数据与阅读

- [x] vLLM 与 vLLM-Ascend 分仓库切换，PR/Issue 列表支持“最近更新”和“编号倒序”两种排序
- [x] Open、Draft、Merged、Closed、Reopened 状态、标题、Markdown 正文、作者、评论数和 GitHub 原链接
- [x] 列表和详情只读取 D1，不隐式请求 GitHub、调用 AI、补抓 Diff 或重新分类
- [x] PR `diff --stat`、完整文件清单和显式按需获取 Patch；单文件变更超过 1000 行时禁止展开并引导到 GitHub
- [x] CI/check、Review Decision、Mergeability、冲突、分支落后、Base/Head/Merge SHA 等事实持久化
- [x] 北京时间自然日事件、每条事项最新事件去重、仓库今日分析和历史 Markdown 文档

## 四类独立刷新任务

- [x] 社区事实：默认每小时自动增量刷新，使用包含边界的成功水位和幂等唯一键
- [x] 摘要分析：默认每 6 小时只处理 missing/stale 版本；PR 可按需获取摘要所需 Patch
- [x] 分类标签：双仓库独立 taxonomy，默认仅首次分类，后续变化只标记 `possibly_stale`
- [x] 深度分析：只允许显式手动启动、重跑当前版本或继续上次分析
- [x] 四类任务独立保存上次尝试、上次成功、下次计划、状态、错误、待处理数量和过期状态
- [x] 单条手动按钮互不触发；失败不推进成功水位；相同版本和 Prompt 不重复分析
- [x] 全局默认与 vLLM/vLLM-Ascend 单仓库覆盖配置持久化到 D1

## 分析质量与 Prompt 管理

- [x] PR/Issue 摘要和深度分析使用独立输入、固定结构、证据完整性和显式版本契约
- [x] PR 分析绑定 Base/Head SHA、正文/文件 Hash、Prompt 模板与修订；Issue 不伪造代码字段
- [x] 未获取、超限或 GitHub 未返回的 Patch 明确进入证据缺口，模型未知文件引用会被移除并降低完整性
- [x] 所有可配置 AI 功能统一进入设置页 Prompt 中心；每个功能支持多模板、新增、复制、编辑、删除自定义模板和切换启用项
- [x] 内置模板只读且不可删除；用户要求只能作为系统契约之后的附加重点
- [x] 历史分析保留模板、修订、Prompt 版本、模型、Provider 和生成时证据

## 技术分类、领域地图与跨仓影响

- [x] vLLM 与 vLLM-Ascend 分别维护独立类别文件、CODEOWNERS/源码/测试/Label 证据和动态分类 Prompt
- [x] 测试文件优先映射回源码技术领域，多领域 PR 只选择一个主类别并保留候选分数
- [x] Issue 证据不足时低置信度回退 Other；AI 只补判规则低置信度结果且不得创造类别
- [x] 设置页可分别运行两仓库“分类标准刷新”Prompt；安全增量持久化到 D1，新类别仅作为待审核建议
- [x] 维护 15 个跨仓库架构领域，显式映射两套 taxonomy；架构基线与北京时间今日变化分层展示
- [x] 跨仓库影响通过架构领域映射关联不同名称的上游/Ascend 类别，不再依赖 `domain` 名称完全相同
- [x] 分类分析证据快照保存在 `docs/classification/TAXONOMY_ANALYSIS.md`

## OpenCode 本地分析

- [x] Local Analysis Runner 主动领取 D1 任务，浏览器不直连 OpenCode，也不接收本地路径、密码或模型密钥
- [x] 默认识别 LoongBoard 同级 `../vllm` 与 `../vllm-ascend`，支持安全 Fetch 和缺失仓库初始化 Clone
- [x] 每次运行使用 `.loongboard/worktrees/<run-id>/` 下 detached Worktree，不切换用户主工作区
- [x] OpenCode Adapter 集中实现健康检查、Provider/Model、Session、消息、SSE、取消、断线和超时
- [x] Session 与 LoongBoard 分析线程绑定；相同 Commit 可连续追问，Head 变化创建新运行并保留旧报告
- [x] 深度分析、显式本地代码洞察和仓库分析对话复用同一 Runner；普通对话不会启动 OpenCode
- [x] 结构化事件和最终报告持久化，刷新页面可恢复；只有实际读取源码并通过代码引用校验后才标记本地证据
- [x] 默认只开放 read/grep/glob/LSP，禁止编辑、写入、任意 Shell、外部目录、凭据、安装和高资源测试

## 账户、凭据与界面

- [x] 本地管理员登录、签名会话、多开发账户及账户隔离的数据空间
- [x] 多套 OpenAI-compatible Provider/API Token 加密保存、测试、切换；保留环境变量调试 Provider
- [x] 每账户 GitHub Token 加密保存、测试和删除；优先级高于服务端 `GITHUB_TOKEN`，前端只显示状态和尾号
- [x] GitHub 403 额度错误区分匿名/认证来源并保留安全端点，不回显调用 IP 或 Token
- [x] 多对话创建、保留、删除和继续；全页与悬浮窗口同步，支持页面上下文和选中文本
- [x] 深色/浅色主题、仓库展开导航和可折叠图标侧栏

## 后续扩展（不属于当前已验收范围）

- [ ] 仓库新增、编辑、停用与删除，以及私有仓库权限模型
- [~] 分类数据层支持锁定人工结果；仍缺少选择类别并保存人工修正的完整 UI
- [ ] 刷新运行历史与失败重试工作台、GitHub 额度趋势提醒
- [ ] 数据备份、恢复、保留期限和清理策略工具
- [ ] 团队分配、避免重复 Review、多人角色权限与 GitHub 写操作
- [ ] 长期趋势、周报/月报、网页/论文等外部数据源和自然语言历史搜索
