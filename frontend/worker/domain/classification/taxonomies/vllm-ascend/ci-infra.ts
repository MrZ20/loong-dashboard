import { defineDomain } from "../../define";

export const ciInfra = defineDomain({
  id: "ci-infra", name: "CI / Infra", description: "GitHub Actions、E2E taxonomy、Docker、构建与测试基础设施。",
  sourcePaths: [".github/workflows/", ".github/labeler.yml", "docker/", "cmake/", "pyproject.toml"],
  testPaths: [], codeownerPaths: [".github/"], titleTerms: ["[ci]", "ci", "workflow", "docker", "e2e taxonomy"],
  bodyTerms: ["nightly", "test pipeline", "coverage taxonomy", "image build"], labelTerms: ["module:tests", "module:tools"],
  excludePaths: [], competingDomains: ["Tests", "Documentation"], priority: 25,
  conflictResolution: "仅无明确源码域时使用；E2E 用例能映射到技术域时不得归 CI。", examples: ["只修改 CI workflow", "只调整 E2E coverage schema"],
  fallbackOnly: true,
});
