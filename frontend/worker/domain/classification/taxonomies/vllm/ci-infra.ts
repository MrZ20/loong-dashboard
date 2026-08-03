import { defineDomain } from "../../define";

export const ciInfra = defineDomain({
  id: "ci-infra",
  name: "CI / Infra",
  description: "Buildkite、GitHub Actions、Docker、构建与测试基础设施。",
  sourcePaths: [".buildkite/", ".github/workflows/", "docker/", "cmake/", "setup.py", "pyproject.toml"],
  testPaths: [],
  codeownerPaths: [".buildkite/", ".github/"],
  titleTerms: ["[ci]", "ci", "buildkite", "docker", "github actions"],
  bodyTerms: ["test pipeline", "build image", "workflow", "nightly", "pre-commit"],
  labelTerms: ["github_actions", "ci"],
  excludePaths: [],
  competingDomains: ["Tests", "Documentation"],
  priority: 30,
  conflictResolution: "仅在没有明确核心源码域时使用；大量 CI 文件不能压过源码修改。",
  examples: ["只修改 Buildkite pipeline", "调整 Docker 构建和 wheel 发布"],
  fallbackOnly: true,
});
