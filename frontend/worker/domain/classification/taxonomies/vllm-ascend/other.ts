import { defineDomain } from "../../define";

export const other = defineDomain({
  id: "other", name: "Other", description: "证据不足或无法可靠映射到已注册 Ascend 技术领域。",
  sourcePaths: [], testPaths: [], codeownerPaths: [], titleTerms: [], bodyTerms: [], labelTerms: [], excludePaths: [], competingDomains: [], priority: 0,
  conflictResolution: "模糊 Issue 或候选接近且无技术证据时保守使用。", examples: ["只有故障现象且无标签、路径、模块或关联 PR"], fallbackOnly: true,
});
