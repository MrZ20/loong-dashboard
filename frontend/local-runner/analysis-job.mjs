import { WorkspaceManager } from "./git-worktrees.mjs";
import { buildRunnerPrompt, validateStructuredResult } from "./prompts.mjs";
import { permissionSystemInstruction, resolvePermissionPolicy } from "./permission-profiles.mjs";

function isStructuredOutputError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("未返回结构化") || message.includes("结构化输出缺少");
}

function saveSession(state, sessionId, prepared, job, sourceRead, engineId) {
  if (!sessionId || prepared.workspaceMode === "ephemeral_worktree") return;
  state.saveSession(sessionId, {
    root: prepared.root,
    worktrees: prepared.worktrees,
    commits: prepared.commits,
    sessionScope: job.sessionScope,
    sourceRead,
    engineId,
    workspaceMode: prepared.workspaceMode,
    permissionProfileId: job.request?.permissionProfileId || "safe_readonly",
  });
}

async function executePreparedAnalysisJob(job, context, git, prepared) {
  const { config, api, state, events, engines } = context;
  const gitEvidence = [];
  if (prepared.workspaceMode !== "none" && ["vllm", "vllm-ascend"].includes(job.repoScope)) {
    const evidence = await git.gitEvidence(job.repoScope, job.baseSha, prepared.commits[job.repoScope]);
    if (evidence.length) {
      gitEvidence.push(...evidence);
      await events.emit("git_query", "git", `[Git] 已读取 ${job.repoScope} 版本差异和提交历史`, {
        repository: job.repoScope,
        commitSha: prepared.commits[job.repoScope],
      });
    }
  }

  const prompt = buildRunnerPrompt(job, prepared, gitEvidence);
  const engine = engines.forJob(job);
  const policy = resolvePermissionPolicy(job, config, prepared, engine.id);
  await events.emit(
    "repository_prepare",
    "runner",
    `[Runner] 工作区 ${prepared.workspaceMode} · 更新 ${job.request?.updatePolicy || "none"} · 权限 ${policy.id}`,
    {
      workspaceMode: prepared.workspaceMode,
      updatePolicy: job.request?.updatePolicy || "none",
      permissionProfileId: policy.id,
    },
  );
  const session = await engine.openSession({ job, prepared, prompt, state, policy });
  const initialSessionId = session.id;
  saveSession(state, session.id, prepared, job, session.sourceRead, engine.id);

  const modelCall = engine.modelCall(job);
  await events.emit("model_call", engine.id, modelCall.message, modelCall.metadata);
  const timeoutMs = Math.max(60, Number(job.request?.timeoutSeconds || config.timeoutSeconds)) * 1_000;
  const execute = (message) => engine.runStructured({
    job,
    session,
    message,
    system: `${permissionSystemInstruction(policy)}\n\n${prompt.systemContract}`,
    policy,
    schema: prompt.schema,
    timeoutMs,
    onEvent: (event) => events.engine(engine, event, prepared),
    shouldCancel: async () => (await api.status(job.id)) === "cancel_requested",
  });

  let response;
  let result;
  try {
    try {
      response = await execute(prompt.prompt);
      session.id = String(response.sessionId || session.id || "");
      result = validateStructuredResult(response.result, prompt.contentField);
    } catch (error) {
      if (!engine.capabilities.formatCorrection || !isStructuredOutputError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await events.emit(
        "warning",
        engine.id,
        "[Agent] 输出格式不符合约定，正在同一 Session 内纠正格式",
        { reason: message },
        "warning",
      );
      response = await execute(
        `上一条回复没有通过 LoongBoard 的结构校验：${message}。不要重新分析，也不要补充说明；请仅把已有结论整理为符合要求的 JSON 对象。`,
      );
      session.id = String(response.sessionId || session.id || "");
      result = validateStructuredResult(response.result, prompt.contentField);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const sessionId = String(error?.sessionId || response?.sessionId || session.id || "");
    failure.runnerResult = {
      ...engine.resultMetadata(job, sessionId),
      resolvedCommits: prepared.commits,
      workspaceMode: prepared.workspaceMode,
      updatePolicy: job.request?.updatePolicy || "none",
      permissionProfileId: policy.id,
    };
    throw failure;
  }

  const sessionId = String(response.sessionId || session.id || "");
  if (initialSessionId && initialSessionId !== sessionId) state.removeSession(initialSessionId);
  await events.emit("report_generate", engine.id, "[Agent] 正在校验代码引用并生成最终报告");
  const codeReferences = git.validateReferences(result.codeReferences, prepared);
  const sourceRead = (events.sourceRead || session.sourceRead) && codeReferences.length > 0;
  saveSession(state, sessionId, prepared, job, sourceRead, engine.id);
  return {
    ...result,
    codeReferences,
    sourceRead,
    ...engine.resultMetadata(job, sessionId),
    resolvedCommits: prepared.commits,
    workspaceMode: prepared.workspaceMode,
    updatePolicy: job.request?.updatePolicy || "none",
    permissionProfileId: policy.id,
  };
}

export async function runAnalysisJob(job, context) {
  const { config, events } = context;
  const git = context.git || new WorkspaceManager(config, (...args) => events.emit(...args));
  await events.emit("repository_prepare", "git", "正在准备本地仓库和分析版本");
  const prepared = await git.prepare(job, context.state);
  let completed = false;
  try {
    const result = await executePreparedAnalysisJob(job, context, git, prepared);
    completed = true;
    return result;
  } finally {
    try {
      await git.finalize(prepared);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await events.emit("error", "git", `[Git] 临时 Worktree 清理失败：${message}`, {}, "error").catch(() => {});
      if (completed) throw error;
    }
  }
}
