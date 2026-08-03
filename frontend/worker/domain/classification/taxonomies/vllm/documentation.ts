import { defineDomain } from "../../define";

export const documentation = defineDomain({
  id: "documentation",
  name: "Documentation",
  description: "纯文档、示例说明与开发者指南。",
  sourcePaths: ["docs/", "README.md", "CONTRIBUTING.md"],
  testPaths: [],
  codeownerPaths: ["docs/"],
  titleTerms: ["docs", "documentation", "readme"],
  bodyTerms: ["document", "tutorial", "guide"],
  labelTerms: ["documentation"],
  excludePaths: [],
  competingDomains: ["CI / Infra", "Other"],
  priority: 20,
  conflictResolution: "仅纯文档变更使用；文档不得覆盖同 PR 的核心源码域。",
  examples: ["仅更新用户指南", "只修正文档示例"],
  fallbackOnly: true,
});
