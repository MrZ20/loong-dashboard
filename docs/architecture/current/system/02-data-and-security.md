# D1 数据域与安全边界

## 数据按业务用途划分

| 数据域 | 主要表 | 保存内容 |
| --- | --- | --- |
| 账户 | `users`、`user_profiles` | 登录身份和个人资料 |
| 仓库事实 | `repositories`、`community_items`、`community_events` | PR/Issue 当前快照、代码统计、Review 信号和事件 |
| 刷新 | `refresh_task_configs`、`refresh_task_runs`、`community_summary_jobs` | 四类刷新配置、运行记录、水位、摘要幂等键 |
| AI 管理 | `ai_providers`、`ai_prompt_templates`、`ai_prompt_preferences`、`ai_task_bindings` | API 配置、Prompt 模板和任务绑定 |
| 本地执行 | `local_runner_settings`、`local_runners`、`local_analysis_jobs`、`local_analysis_events`、`engine_session_bindings` | Runner 状态、任务、事件和 Session 映射 |
| 内容 | `analysis_documents`、`domain_snapshots`、`technical_documents` | 深度分析、洞察、领域地图和技术文档 |
| 用户工作 | `watchlist`、`cross_repo_impacts`、`chat_threads`、`chat_messages` | 关注项、适配关系和会话历史 |

## PR/Issue 为什么不会出现重复记录

`community_items` 同时使用两层唯一标识：

- 业务主键：`<repo-id>:<kind>:<number>`，例如 `vllm-ascend:pr:13642`；
- 数据库唯一约束：`UNIQUE(repo_id, kind, number)`。

事实刷新允许重复读取水位边界上的同一条数据，但写入时更新同一记录。这样既不会漏掉相同 `updated_at` 的条目，也不会因为分页重叠产生重复 PR。

## 当前快照与历史结果如何同时保存

`community_items` 保存当前状态；`community_events` 保存观察到的 opened、updated、draft、ready、merged、closed 和 reopened 事件。摘要和分类的当前状态也放在 `community_items`，而完整深度分析与洞察作为 `analysis_documents` 独立保存。

因此 PR 更新后的表现是：

- 列表展示新的当前事实；
- 旧深度报告继续存在；
- 若 Head SHA 已变化，旧报告标记为 `outdated`；
- 新摘要只能写入与当前 `head_sha/body_hash/files_hash` 匹配的记录。

## 凭据保存边界

| 凭据 | 保存位置 | 浏览器可见内容 |
| --- | --- | --- |
| 账户 AI API Token | D1 `ai_providers.encrypted_token`，使用服务端密钥加密 | 是否已配置、末四位提示，不回显明文 |
| GitHub Token | D1 `github_credentials.encrypted_token`，使用服务端密钥加密 | 来源、末四位、验证账号和额度，不回显明文 |
| 环境变量 AI/GitHub Token | Worker 环境变量 | 只显示“已配置”状态 |
| Runner Token | Worker 与本机 Runner 环境配置 | 浏览器不返回 |
| OpenCode / Codex 认证 | 本机 Runner 或引擎配置 | 只显示健康、认证和模型目录 |
| 本地仓库路径 | `.loongboard/runner.json` | 页面只显示仓库是否存在和可用，不返回绝对路径 |

## 权限不是 Prompt

Prompt 只能告诉模型要完成什么，不能扩大工具权限。Runner 会根据 `permission_profile_id`、执行引擎、工作区模式和本机 allow-list 再次校验：

- `safe_readonly`：读取、搜索、LSP 和受限 Git 查询；
- `community_research`：在只读基础上增加网页检索与只读 `gh`；
- `worktree_development`：只在独立 Worktree 中允许编辑和受限验证。

Fetch 与临时 checkout 是 Runner 在 Agent 启动前完成的准备动作，不代表 Agent 获得任意 Git 权限。

## 迁移规则

D1 结构只通过 `frontend/drizzle/NNNN_*.sql` 前进。页面设置不得只保存在 Local Storage；Local Storage 仅适合主题、侧边栏折叠等非业务偏好。任何影响刷新、模型、Prompt、仓库或权限的配置都必须进入 Worker/D1 或本机 Runner 配置。
