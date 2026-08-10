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

const stringArraySchema = { type: "array", items: { type: "string" } };

export const PR_SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary", "purpose", "implementation", "affectedAreas", "keyChanges",
    "testing", "risks", "uncertainties", "evidenceCompleteness",
  ],
  properties: {
    summary: { type: "string" },
    purpose: { type: "string" },
    implementation: { type: "string" },
    affectedAreas: stringArraySchema,
    keyChanges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "symbols", "change", "evidenceType"],
        properties: {
          file: { type: "string" },
          symbols: stringArraySchema,
          change: { type: "string" },
          evidenceType: { type: "string", enum: ["code", "test", "config", "docs"] },
        },
      },
    },
    testing: {
      type: "object",
      additionalProperties: false,
      required: ["covered", "missing"],
      properties: { covered: stringArraySchema, missing: stringArraySchema },
    },
    risks: stringArraySchema,
    uncertainties: stringArraySchema,
    evidenceCompleteness: { type: "string", enum: ["complete", "partial", "insufficient"] },
  },
};

export const ISSUE_SUMMARY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary", "issueType", "symptom", "environment", "reproduction", "impact",
    "suspectedScope", "confirmedFacts", "hypotheses", "missingEvidence", "confidence",
  ],
  properties: {
    summary: { type: "string" },
    issueType: {
      type: "string",
      enum: ["bug", "performance", "feature", "rfc", "usage", "compatibility", "other"],
    },
    symptom: { type: "string" },
    environment: {
      type: "object",
      additionalProperties: false,
      required: ["model", "hardware", "softwareVersions", "parallelism", "other"],
      properties: {
        model: stringArraySchema,
        hardware: stringArraySchema,
        softwareVersions: stringArraySchema,
        parallelism: stringArraySchema,
        other: stringArraySchema,
      },
    },
    reproduction: {
      type: "object",
      additionalProperties: false,
      required: ["available", "steps", "missing"],
      properties: {
        available: { type: "boolean" },
        steps: stringArraySchema,
        missing: stringArraySchema,
      },
    },
    impact: { type: "string" },
    suspectedScope: stringArraySchema,
    confirmedFacts: stringArraySchema,
    hypotheses: stringArraySchema,
    missingEvidence: stringArraySchema,
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

function resultSchema(contentField, contentSchema = { type: "string" }) {
  return {
    type: "object",
    additionalProperties: false,
    required: [contentField, "summaryMd", "codeReferences", "confirmedFacts", "unresolvedIssues", "focus"],
    properties: {
      [contentField]: contentSchema,
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

export function managedTaskSchema(job) {
  if (job.request?.purpose !== "community_summary") return MANAGED_TASK_SCHEMA;
  return resultSchema(
    "outputText",
    job.subjectKind === "issue" ? ISSUE_SUMMARY_OUTPUT_SCHEMA : PR_SUMMARY_OUTPUT_SCHEMA,
  );
}

export function validateStructuredResult(result, contentField) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("本地分析引擎未返回结构化 JSON 对象");
  }
  const content = result[contentField];
  const structuredManagedOutput = contentField === "outputText" &&
    content && typeof content === "object" && !Array.isArray(content);
  if ((typeof content !== "string" || !content.trim()) && !structuredManagedOutput) {
    throw new Error(`本地分析引擎结构化输出缺少 ${contentField}`);
  }
  if (typeof result.summaryMd !== "string") throw new Error("本地分析引擎结构化输出缺少 summaryMd");
  for (const field of ["codeReferences", "confirmedFacts", "unresolvedIssues", "focus"]) {
    if (!Array.isArray(result[field])) throw new Error(`本地分析引擎结构化输出缺少 ${field}`);
  }
  return structuredManagedOutput
    ? { ...result, outputText: JSON.stringify(content) }
    : result;
}

const EVIDENCE_SYSTEM = `所有代码结论必须先实际读取源码，并在 codeReferences 中给出仓库、完整 Commit SHA、相对文件路径、类或函数、行号范围和引用理由；无法确定行号时用 0。无法从代码确认的内容必须放入 unresolvedIssues，不能伪称已检查。最终使用 Markdown，明确区分已确认事实、代码证据、风险和待确认项。`;

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

function managedTaskGuidance(job) {
  if (job.request?.purpose === "classification_supplement") {
    return `该任务的工具预算最多为 6 次读取、搜索或 Git 查询，禁止全仓库扫描。业务判断要求只来自当前绑定的提示词。`;
  }
  if (job.request?.purpose === "taxonomy_refresh") {
    return `该任务是数据库证据包模式，只能使用任务上下文，不得调用读取、搜索、Shell、Git、LSP、联网或其他工具。业务判断要求只来自当前绑定的提示词。`;
  }
  return "";
}

export function buildRunnerPrompt(job, prepared, gitEvidence) {
  const context = commonContext(job, prepared, gitEvidence);
  const managedPrompt = job.request?.prompt || {};
  const instruction = String(managedPrompt.instruction || "").trim();
  if (!instruction) throw new Error("AI 任务提示词为空，Runner 拒绝执行");
  const promptHeader = `${managedPrompt.systemContract || ""}\n\n当前启用要求（${managedPrompt.templateName || "未命名提示词"} · r${managedPrompt.revision || 1}）：\n${instruction}`;
  const systemContract = EVIDENCE_SYSTEM;
  if (job.jobType === "repository_chat") {
    return {
      title: `LoongBoard 仓库问答 · ${job.subjectKey}`,
      schema: CHAT_SCHEMA,
      contentField: "answerMd",
      systemContract,
      prompt: `${promptHeader}\n\n任务上下文：\n${context}`,
    };
  }
  if (job.jobType === "insight_evidence") {
    return {
      title: `LoongBoard 本地代码洞察 · ${job.subjectKey}`,
      schema: REPORT_SCHEMA,
      contentField: "reportMd",
      systemContract,
      prompt: `${promptHeader}\n\n任务上下文：\n${context}`,
    };
  }
  if (job.jobType === "managed_ai_task") {
    const schema = managedTaskSchema(job);
    const structuredSummary = job.request?.purpose === "community_summary";
    const taskGuidance = managedTaskGuidance(job);
    return {
      title: `LoongBoard AI 任务 · ${job.subjectKey}`,
      schema,
      contentField: "outputText",
      systemContract,
      prompt: `${promptHeader}\n\n${taskGuidance ? `${taskGuidance}\n\n` : ""}${structuredSummary
        ? "请把任务要求的摘要 JSON 对象放入 outputText 属性；outputText 必须是对象，不要序列化为字符串。"
        : "请把任务要求的最终正文或 JSON 放入 outputText；不要把结构化封装字段混入 outputText。"}\n\n任务上下文：\n${context}`,
    };
  }
  return {
    title: `LoongBoard 深度分析 · ${job.subjectKey}`,
    schema: REPORT_SCHEMA,
    contentField: "reportMd",
    systemContract,
    prompt: `${promptHeader}\n\n任务上下文：\n${context}`,
  };
}
