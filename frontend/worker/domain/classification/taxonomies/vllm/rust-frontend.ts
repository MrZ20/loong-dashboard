import { defineDomain } from "../../define";

export const rustFrontend = defineDomain({
  id: "rust-frontend",
  name: "Rust Frontend",
  description: "Rust server、CLI、managed engine、parser、tokenizer 与 Engine Core client。",
  sourcePaths: ["rust/"],
  testPaths: ["rust/src/llm/tests/", "rust/src/chat/tests/", "tests/tool_parsers/test_rust_tool_parser.py"],
  codeownerPaths: ["rust/"],
  titleTerms: ["rust frontend", "rust server", "cargo", "rust cli"],
  bodyTerms: ["managed engine", "engine-core-client", "rust tokenizer", "rust parser"],
  labelTerms: ["rust", "frontend"],
  excludePaths: ["docs/"],
  competingDomains: ["Serving & APIs", "Engine & Model Runner", "Sampling & Structured Output"],
  priority: 109,
  conflictResolution: "任何 Rust 核心实现路径命中时优先；Python 侧协议改动仍按对应 Python 技术域比较源码修改量。",
  examples: ["修改 rust/src/server", "扩展 Rust Engine Core client 与 Cargo tests"],
});
