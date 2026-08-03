import { defineDomain } from "../../define";

export const multimodal = defineDomain({
  id: "multimodal",
  name: "Multimodal",
  description: "图像/音频/视频输入处理、多模态 registry、processor 与模型接口。",
  sourcePaths: ["vllm/multimodal/", "vllm/model_executor/models/interfaces.py", "vllm/inputs/"],
  testPaths: ["tests/multimodal/", "tests/models/multimodal/", "tests/entrypoints/openai/test_vision"],
  codeownerPaths: ["vllm/multimodal/"],
  titleTerms: ["multimodal", "multi-modal", "vision", "audio", "video"],
  bodyTerms: ["image input", "audio input", "mm processor", "multimodal registry", "vision language"],
  labelTerms: ["multi-modality"],
  excludePaths: ["docs/"],
  competingDomains: ["Model Support & Weight Loading", "Serving & APIs"],
  priority: 102,
  conflictResolution: "多模态输入/processor 为主时优先；仅模型权重映射归 Model Support。",
  examples: ["修改 multimodal processing cache", "新增视觉输入 parser 与测试"],
});
