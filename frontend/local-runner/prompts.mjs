const referenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["repository", "commitSha", "path", "symbol", "startLine", "endLine", "reason"],
  properties: {
    repository: { type: "string", enum: ["vllm", "vllm-ascend"] },
    commitSha: { type: "string" },
    path: { type: "string" },
    symbol: { type: "string" },
    startLine: { type: "integer", minimum: 0 },
    endLine: { type: "integer", minimum: 0 },
    reason: { type: "string" },
  },
};

function resultSchema(contentField) {
  return {
    type: "object",
    additionalProperties: false,
    required: [contentField, "summaryMd", "codeReferences", "confirmedFacts", "unresolvedIssues", "focus"],
  properties: {
      [contentField]: { type: "string" },
      summaryMd: { type: "string" },
      codeReferences: { type: "array", items: referenceSchema },
      confirmedFacts: { type: "array", items: { type: "string" } },
      unresolvedIssues: { type: "array", items: { type: "string" } },
      focus: { type: "array", items: { type: "string" } },
    },
  };
}

export const REPORT_SCHEMA = resultSchema("reportMd");
export const CHAT_SCHEMA = resultSchema("answerMd");
export const MANAGED_TASK_SCHEMA = resultSchema("outputText");

export function validateStructuredResult(result, contentField) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("OpenCode 未返回结构化 JSON 对象");
  }
  if (typeof result[contentField] !== "string" || !result[contentField].trim()) {
    throw new Error(`OpenCode 结构化输出缺少 ${contentField}`);
  }
  if (typeof result.summaryMd !== "string") throw new Error("OpenCode 结构化输出缺少 summaryMd");
  for (const field of ["codeReferences", "confirmedFacts", "unresolvedIssues", "focus"]) {
    if (!Array.isArray(result[field])) throw new Error(`OpenCode 结构化输出缺少 ${field}`);
  }
  return result;
}

export const READ_ONLY_SYSTEM = `你是 LoongBoard 的本地代码分析 Agent。你只能读取当前工作目录中的源码，使用 read、grep、glob 与 LSP；不得编辑、写入或删除文件，不得运行 Shell，不得读取 .env、凭据或工作目录之外的内容。不要展示隐藏推理过程。

所有代码结论必须先实际读取源码，并在 codeReferences 中给出仓库、完整 Commit SHA、相对文件路径、类或函数、行号范围和引用理由；无法确定行号时用 0。无法从代码确认的内容必须放入 unresolvedIssues，不能伪称已检查。最终使用 Markdown，明确区分已确认事实、代码证据、风险和待确认项。`;

function commonContext(job, prepared, gitEvidence) {
  return JSON.stringify({
    taskType: job.jobType,
    subject: { kind: job.subjectKind, key: job.subjectKey },
    repositoryScope: job.repoScope,
    resolvedCommits: prepared.commits,
    worktrees: prepared.worktrees,
    gitEvidence,
    request: job.request,
  }, null, 2);
}

export function buildRunnerPrompt(job, prepared, gitEvidence) {
  const context = commonContext(job, prepared, gitEvidence);
  const managedPrompt = job.request?.prompt || {};
  const promptHeader = `${managedPrompt.systemContract || ""}\n\n当前启用要求（${managedPrompt.templateName || "系统默认"} · r${managedPrompt.revision || 1}）：\n${managedPrompt.instruction || "根据证据完成只读分析。"}`;
  if (job.jobType === "repository_chat") {
    return {
      title: `LoongBoard 仓库问答 · ${job.subjectKey}`,
      schema: CHAT_SCHEMA,
      contentField: "answerMd",
      prompt: `${promptHeader}\n\n任务上下文：\n${context}`,
    };
  }
  if (job.jobType === "insight_evidence") {
    return {
      title: `LoongBoard 本地代码洞察 · ${job.subjectKey}`,
      schema: REPORT_SCHEMA,
      contentField: "reportMd",
      prompt: `${promptHeader}\n\n任务上下文：\n${context}`,
    };
  }
  if (job.jobType === "managed_ai_task") {
    return {
      title: `LoongBoard AI 任务 · ${job.subjectKey}`,
      schema: MANAGED_TASK_SCHEMA,
      contentField: "outputText",
      prompt: `${promptHeader}\n\n请把任务要求的最终正文或 JSON 放入 outputText；不要把结构化封装字段混入 outputText。\n\n任务上下文：\n${context}`,
    };
  }
  return {
    title: `LoongBoard 深度分析 · ${job.subjectKey}`,
    schema: REPORT_SCHEMA,
    contentField: "reportMd",
    prompt: `${promptHeader}\n\n任务上下文：\n${context}`,
  };
}
