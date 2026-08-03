import { defineDomain } from "../../define";

export const tests = defineDomain({
  id: "tests", name: "Tests", description: "无法依据 E2E feature/arch/parallel/graph taxonomy 映射的通用测试基础设施。",
  sourcePaths: [], testPaths: ["tests/"], codeownerPaths: [], titleTerms: ["test framework", "pytest", "test utility"],
  bodyTerms: ["fixture", "test harness"], labelTerms: ["module:tests"], excludePaths: [], competingDomains: ["CI / Infra", "Other"], priority: 10,
  conflictResolution: "先用 feature/arch/parallel/graph 语义映射回技术领域，只在完全无法映射时使用。", examples: ["只修改无领域语义的通用 fixture"], fallbackOnly: true,
});
