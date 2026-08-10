# 状态、版本与失败恢复

LoongBoard 同时展示 GitHub 当前事实、AI 任务状态和历史报告。理解这些状态可以避免把“任务运行失败”“结果已过期”和“页面暂时没轮询到”混为一谈。

## 四类刷新状态

`refresh_task_configs.status` 使用：

```text
idle → queued → running → ready
                    └────→ failed
```

每次运行还单独保存到 `refresh_task_runs`，因此配置卡显示的是该类任务当前/最近状态，历史运行不会丢失。

| 字段 | 含义 | 失败时行为 |
| --- | --- | --- |
| `last_attempted_at` | 最近开始尝试时间 | 更新 |
| `last_successful_at` | 最近完整成功时间 | 不更新 |
| `watermark_updated_at` | Facts 增量成功水位 | 不更新 |
| `next_scheduled_at` | 下次计划时间 | 按周期重新计算 |
| `last_error` | 最近一次失败原因 | 保留到成功或显式清除 |
| `current_stage` | discovering/enriching/saving 等 | 变为 failed |
| `progress_current/total` | 当前运行进度 | 保留失败位置用于说明 |

运行中 Job 使用心跳和租约。Worker 发现租约过期时把运行重新排队，而不是直接推进水位或宣告成功。

## 摘要状态

```text
missing → queued → running → ready
   ↑           └──────→ failed
   └──────── stale ← 事实版本变化
```

当前摘要只有在以下版本完全匹配时才是 current：

- PR：`summary_head_sha`、`summary_body_hash`、`summary_files_hash`、Prompt 版本；
- Issue：正文 Hash、Prompt 版本。

事实刷新根据任务规则决定何时标记 stale。默认 PR 代码或正文变化、Issue 正文变化；CI 或评论是否触发由设置开关控制。

摘要失败只在当前条目版本仍等于失败任务版本时写 `summary_error`，避免旧任务把新版本标成失败。

## 分类状态

```text
missing → running → ready
   └──────────────→ failed
ready → possibly_stale
```

`possibly_stale` 表示事实已变化但默认“仅首次分类”不会自动覆盖。页面同时显示分类基于的 Head SHA、生成时间、taxonomy 版本、置信度和候选分数。

人工修正会设置 `classification_locked`。任何自动任务或本地 Agent completion 都会在写入前检查该锁和当前版本。

## 深度分析状态与历史

条目保存 `missing/running/ready/outdated/failed` 的简要状态；每份实际报告保存在 `analysis_documents`。Head SHA 变化时：

- 当前条目状态从 ready 变为 outdated；
- 旧文档的 `version_status` 变为 outdated；
- 文档不会删除；
- 不会自动启动新深度分析。

如果分析运行期间代码更新，完成处理仍保存报告，但按旧版本标记，不更新当前条目的 ready 状态。

## 本地 Job 状态

`local_analysis_jobs` 使用：

```text
queued → claimed → running → completed
                    ├──────→ failed
                    ├──────→ cancel_requested → cancelled
                    └──────→ 超时/离线后可重试
```

页面按 Job ID 和最后 `sequence` 增量读取事件。刷新页面后，任务、错误与历史事件都来自 D1，不依赖原浏览器内存。

## AI 任务最近状态

`ai_task_bindings` 保存 `last_run_at/last_status/last_error`，用于设置页定位是哪一个业务任务、配置和模型失败。成功会清除旧错误；设置页也提供显式删除最近错误的接口。

这与某条 PR 的 `summary_error` 不同：前者描述任务配置最近运行，后者描述具体条目当前版本的摘要结果。

## 版本快照清单

一份可审计 AI 结果至少记录：

| 结果 | 必须绑定 |
| --- | --- |
| PR 摘要 | Head SHA、Body Hash、Files Hash、Prompt ID/Revision/Version、Provider、Model |
| Issue 摘要 | Body Hash、Prompt ID/Revision/Version、Provider、Model |
| 分类 | Head/Body/Files、taxonomy version、证据、置信度、来源 |
| 深度分析 | Base/Head、Body/Files、Prompt、Runner/Provider/Model、Session、代码引用 |
| 本地代码洞察 | Commit、Runner/Provider/Model、Session、代码引用、localEvidence |
| 仓库对话 | repo scope、target ref、Commit、Session、消息级代码引用 |

## 错误排查顺序

### GitHub 刷新失败

1. `refresh_task_configs.last_error`；
2. 对应 `refresh_task_runs.stage/error`；
3. GitHub REST 与 GraphQL 剩余额度；
4. 是否完整到达水位边界；
5. 是否有 GraphQL 目标 PR 缺失或大文件续页失败。

### 摘要失败

1. `community_items.summary_status/summary_error`；
2. `community_summary_jobs` 是否 queued/running/failed；
3. 任务绑定是 API 还是本地 Agent；
4. API：任务 `last_error` 与 Provider/Token；
5. 本地：`local_analysis_jobs`；
6. `local_analysis_events` 区分仓库准备、模型结构、版本拒写和前端轮询。

### 本地分析失败

1. Runner 最近心跳是否在线；
2. 引擎是否健康/认证；
3. 仓库或 Worktree 是否准备成功；
4. 权限档案是否允许；
5. 模型是否返回业务 Schema；
6. 代码引用是否通过 Commit/路径校验；
7. completion handler 是否因当前版本已变化拒绝覆盖。

不要只根据页面的一条红色提示推断根因。D1 任务记录和结构化事件才是完整执行证据。
