import { defineDomain } from "../../define";

export const other = defineDomain({
  id: "other",
  name: "Other",
  description: "证据不足或无法可靠映射到已注册技术领域。",
  sourcePaths: [], testPaths: [], codeownerPaths: [], titleTerms: [], bodyTerms: [], labelTerms: [], excludePaths: [],
  competingDomains: [], priority: 0,
  conflictResolution: "Issue 只有故障现象或证据互相矛盾时保守使用。",
  examples: ["没有标签、模块、路径或关联 PR 的模糊 Issue"],
  fallbackOnly: true,
});
