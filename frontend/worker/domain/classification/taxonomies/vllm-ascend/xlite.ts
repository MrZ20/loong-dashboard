import { defineDomain } from "../../define";

export const xlite = defineDomain({
  id: "xlite", name: "XLite",
  description: "XLite 执行后端、集成层与其专属算子/运行路径。",
  sourcePaths: ["vllm_ascend/xlite/"], testPaths: ["tests/unit_tests/xlite/", "tests/e2e/singlecard/xlite/"],
  codeownerPaths: ["vllm_ascend/xlite/"], titleTerms: ["xlite"], bodyTerms: ["xlite backend", "xlite executor"], labelTerms: ["module:mindie-turbo"],
  excludePaths: [], competingDomains: ["Worker & Graph", "Compilation"], priority: 114,
  conflictResolution: "XLite 路径明确命中时优先。", examples: ["修改 XLite backend", "新增 XLite E2E"], e2eCoverageTerms: ["xlite"],
});
