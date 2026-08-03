import { defineDomain } from "../../define";

export const documentation = defineDomain({
  id: "documentation", name: "Documentation", description: "纯文档、教程、部署指南与 Release 说明。",
  sourcePaths: ["docs/", "README.md", "CONTRIBUTING.md"], testPaths: [], codeownerPaths: ["docs/"],
  titleTerms: ["docs", "documentation", "readme"], bodyTerms: ["tutorial", "guide", "document"], labelTerms: ["documentation"], excludePaths: [],
  competingDomains: ["CI / Infra", "Other"], priority: 20,
  conflictResolution: "仅纯文档变更使用；不能覆盖同 PR 的核心源码域。", examples: ["只更新 310P 部署文档"], fallbackOnly: true,
});
