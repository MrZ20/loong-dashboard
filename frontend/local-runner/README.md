# LoongBoard Local Analysis Runner

## 执行引擎边界

Runner 的任务编排只依赖 `EngineRegistry` 中的统一 Adapter 合约。OpenCode
和 Codex 分别在 `engines/opencode-adapter.mjs`、
`engines/codex-adapter.mjs` 内实现健康检查、模型目录、Session、历史、事件、
结构化运行和取消能力；OpenCode Server 的本地生命周期也完全由其 Adapter
管理。新增执行引擎时，实现同一合约并注册即可，不需要修改任务编排。

任务输入和结果统一使用 `engineId`、`agentSessionId`。Runner 心跳通过
`engines`、`engineVersions` 和 `engineCatalogs` 上报各引擎的健康状态、版本、
模型与能力，不保留 OpenCode 专属的历史协议字段。

The Runner is the only component allowed to access local repositories and the
OpenCode or Codex App Server. The browser and Cloudflare Worker communicate with it through
durable jobs and sanitized events.

1. Copy `runner.example.json` to `../.loongboard/runner.json` (the directory is
   ignored by Git), then configure the same `runnerToken` as
   `LOCAL_RUNNER_TOKEN` in the Worker environment.
2. Start the service, apply D1 migrations, then run `npm run runner`.
3. Enable Local Analysis on the LoongBoard settings page.

OpenCode is started on `127.0.0.1` by default. Codex is started through the
local stdio App Server and reuses the machine's existing `codex login` session.
Source paths, OpenCode passwords and authentication state remain in the local
Runner and are never returned to the browser.

Each AI task independently selects `none`, `ephemeral_worktree` or `worktree`
as its workspace mode, plus `none` or `fetch` as its update policy. Permissions
are selected from Runner-enforced profiles. Codex currently supports only
`safe_readonly`; OpenCode also supports community research and an opt-in
Worktree-only development profile. `ephemeral_worktree` creates an isolated
detached Worktree for every job and removes it immediately after success,
failure or cancellation, so parallel jobs never switch or lock the shared
repository checkout. `worktree` is reserved for same-version sessions that
explicitly need a retained code workspace. See
[`docs/architecture/current/`](../../docs/architecture/current/README.md) for
the complete current architecture and deployment rules.
