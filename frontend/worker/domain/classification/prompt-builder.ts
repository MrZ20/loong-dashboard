import type { RepositoryTaxonomy } from "./types";

export function buildClassificationSystemPrompt(taxonomy: RepositoryTaxonomy) {
  const categories = taxonomy.domains.map((domain) => `### ${domain.name} (${domain.id})
职责：${domain.description}
强源码路径：${domain.sourcePaths.join("、") || "无"}
测试映射：${domain.testPaths.join("、") || "无"}
CODEOWNERS：${domain.codeownerPaths.join("、") || "无"}
标题词：${domain.titleTerms.join("、") || "无"}
正文词：${domain.bodyTerms.join("、") || "无"}
排除：${domain.excludePaths.join("、") || "无"}
易混淆：${domain.competingDomains.join("、") || "无"}
冲突规则：${domain.conflictResolution}
典型正例：${domain.examples.join("；")}`).join("\n\n");

  return `你是 ${taxonomy.name} 的 PR/Issue 单一主要技术类别补判器。
规则版本：${taxonomy.version}。只能从下面已经注册的类别中选择一个 domain，不得创造新类别。

证据优先级：
PR：核心源码修改量 > 强源码路径命中数 > 最具体 CODEOWNERS > 测试与源码共同支持 > GitHub Label > 标题 > 正文。
Issue：GitHub Label > 正文明示的文件、类或模块 > 关联 PR 的类别 > 标题 > 正文。
测试必须映射回实际技术领域，不得因为测试文件多就覆盖明确源码；文档与 CI 也不得压过核心源码。
只有规则分类置信度低时才会调用你。证据不足时选择 Other 并降低 confidence。

已注册类别：
${categories}

只输出 JSON：
{"domain":"已注册类别名称","confidence":0.0,"mainEvidence":["证据"],"reason":"简短说明"}`;
}

export function buildTaxonomyRefreshSystemPrompt(taxonomy: RepositoryTaxonomy) {
  return `你是 ${taxonomy.name} 技术分类标准维护助手。审查现有规则与近期真实改动证据，提出保守的增量标准更新。
不得删除或重命名现有类别，不得把变更类型、风险、硬件、模型或并行方式新增为独立输出维度。
可以为现有类别补充 sourcePaths、testPaths、codeownerPaths、titleTerms、bodyTerms、labelTerms、excludePaths；新类别只能进入 newDomainProposals，不能直接生效。
路径必须是仓库内相对路径或 glob，不能包含 ..、绝对路径、URL 或凭据。
测试路径必须映射到技术领域；文档、测试和 CI 不得覆盖明确核心源码。
只输出 JSON：
{"domains":[{"id":"现有类别 id","sourcePaths":[],"testPaths":[],"codeownerPaths":[],"titleTerms":[],"bodyTerms":[],"labelTerms":[],"excludePaths":[],"rationale":"依据"}],"newDomainProposals":[{"id":"候选 id","name":"候选名称","rationale":"为何需要","evidence":["路径或 PR"]}],"analysisMarkdown":"# 分类标准刷新分析\\n..."}`;
}
