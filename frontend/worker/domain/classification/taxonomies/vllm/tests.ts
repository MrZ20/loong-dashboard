import { defineDomain } from "../../define";

export const tests = defineDomain({
  id: "tests",
  name: "Tests",
  description: "无法映射到任何注册技术领域的通用测试框架与测试工具。",
  sourcePaths: [],
  testPaths: ["tests/"],
  codeownerPaths: [],
  titleTerms: ["test coverage", "test framework", "pytest"],
  bodyTerms: ["test utility", "test harness"],
  labelTerms: ["tests"],
  excludePaths: [],
  competingDomains: ["CI / Infra", "Other"],
  priority: 10,
  conflictResolution: "所有可映射的测试先归对应技术领域，仅剩通用测试基础设施时使用。",
  examples: ["只调整通用 pytest fixture 且无法定位技术模块"],
  fallbackOnly: true,
});
