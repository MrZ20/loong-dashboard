import {
  architectureTaxonomyDomains,
  DOMAIN_ARCHITECTURES,
  type DomainArchitecture,
} from "./architecture-catalog";

export function domainSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function executionNodes(pipeline: string) {
  return pipeline
    .split("→")
    .map((label, index) => ({ id: `step-${index + 1}`, label: label.trim(), order: index + 1 }))
    .filter((item) => item.label);
}

export function architectureStages(architecture: DomainArchitecture) {
  return [
    {
      label: "vLLM 上游核心",
      repository: "vllm",
      responsibility: "定义通用执行语义、核心接口与默认实现。",
      paths: architecture.upstreamPaths,
      symbols: architecture.symbols.slice(0, 2),
    },
    {
      label: "Ascend 适配层",
      repository: "vllm-ascend",
      responsibility: "在保持上游语义的前提下实现 NPU 后端、设备能力与必要扩展。",
      paths: architecture.ascendPaths,
      symbols: architecture.symbols.slice(2),
    },
    {
      label: "验证与测试",
      repository: "tests",
      responsibility: "验证正确性、性能和稳定性，并约束上游与 Ascend 的行为一致性。",
      paths: architecture.testPaths,
      symbols: ["correctness", "performance", "stability"],
    },
  ];
}

export function architectureMarkdown(domain: string) {
  const architecture = DOMAIN_ARCHITECTURES[domain];
  if (!architecture) return `# ${domain}\n\n尚未建立代码架构基线。`;
  const stages = architectureStages(architecture);
  const taxonomyDomains = architectureTaxonomyDomains(architecture);
  return `# ${domain} 技术架构基线

## 领域定位与边界

${architecture.description}

该基线描述稳定的技术结构，不代表某一天的社区活动。

## 双仓库分类映射

- **vLLM**：${taxonomyDomains.vllm.length ? taxonomyDomains.vllm.join("、") : "无独立分类"}
- **vLLM-Ascend**：${taxonomyDomains["vllm-ascend"].length ? taxonomyDomains["vllm-ascend"].join("、") : "无独立分类"}

## 技术结构图

${architecture.pipeline}

## 核心组件与职责

${architecture.symbols.map((symbol) => `- **${symbol}**：领域关键实现或技术概念，具体职责以对应路径和当前 Commit 源码为准。`).join("\n")}

## vLLM 上游与 Ascend 实现映射

${stages.map((stage) => `### ${stage.label}（${stage.repository}）\n\n${stage.responsibility}\n\n${stage.paths.map((path) => `- \`${path}\``).join("\n")}`).join("\n\n")}

## 关键执行链与数据流

${executionNodes(architecture.pipeline).map((node, index, nodes) => `${index + 1}. **${node.label}**${index < nodes.length - 1 ? ` → 进入 **${nodes[index + 1].label}**` : " → 产生领域输出"}`).join("\n")}

## 验证入口与架构不变量

${architecture.testPaths.map((path) => `- \`${path}\``).join("\n")}

- 上游语义与 Ascend 适配行为需要保持一致。
- 今日变化必须落到上述节点、实现映射或验证入口，不能替代架构基线。`;
}

export function domainSnapshotFallback(
  domain: string,
  date: string,
  map: Record<string, any>,
) {
  const architecture = DOMAIN_ARCHITECTURES[domain];
  const today = map.today;
  const taxonomyDomains = architectureTaxonomyDomains(architecture);
  const changes = today.changes.length
    ? today.changes.map((change: Record<string, any>) =>
        `- **${change.repo} ${change.kind === "pr" ? "PR" : "Issue"} #${change.number}** ${change.title}\n  - 事件：${change.eventType} · ${change.occurredAt}\n  - 架构落点：${map.name}${today.changedPaths.length ? ` · ${today.changedPaths.slice(0, 3).map((path: string) => `\`${path}\``).join("、")}` : " · 未定位到已同步代码路径"}`,
      ).join("\n")
    : "- 今日暂无已同步变化。";
  return `# ${domain} 技术领域地图

## 领域定位与边界

${architecture.description}

本领域地图以稳定架构基线为主体，并将北京时间自然日的变化作为独立覆盖层。

## 双仓库分类映射

- **vLLM**：${taxonomyDomains.vllm.length ? taxonomyDomains.vllm.join("、") : "无独立分类"}
- **vLLM-Ascend**：${taxonomyDomains["vllm-ascend"].length ? taxonomyDomains["vllm-ascend"].join("、") : "无独立分类"}

## 技术结构图

${architecture.pipeline}

## 核心组件与职责

${architecture.symbols.map((symbol) => `- **${symbol}**：关键实现或领域概念，职责需结合对应路径与当前 Commit 确认。`).join("\n")}

## vLLM 上游与 Ascend 实现映射

${map.stages.map((stage: Record<string, any>) => `### ${stage.label}\n\n${stage.responsibility}\n\n${stage.paths.map((path: string) => `- \`${path}\``).join("\n")}`).join("\n\n")}

## 关键执行链与数据流

${map.architecture.executionFlow.map((node: Record<string, any>, index: number, nodes: Record<string, any>[]) => `${index + 1}. **${node.label}**${index < nodes.length - 1 ? ` → **${nodes[index + 1].label}**` : " → 领域输出"}`).join("\n")}

## 验证入口与架构不变量

${architecture.testPaths.map((path) => `- \`${path}\``).join("\n")}

- 保持上游语义与 Ascend 设备实现的一致性。
- 任何活跃路径都需要相应正确性、性能或稳定性证据。

## 今日变化（北京时间 ${date}）

${changes}

## 变化落点与影响

${today.changedPaths.length ? today.changedPaths.map((path: string) => `- \`${path}\`：已进入今日活跃路径，具体调用链影响待结合 Patch 或本地源码确认。`).join("\n") : "- 今日没有可定位到代码路径的已同步变化。"}

## 风险与待确认

- 当前文档只使用数据库中的社区事实与维护的架构基线；未调用本地代码检索时，不代表已经检查源码。
- 缺少 Patch、测试或调用链证据的变化需要进一步确认。

## 证据

- 架构基线：LoongBoard 领域配置
- 今日社区事件：${today.changes.length} 条（北京时间 ${date}）
- 今日已同步路径：${today.changedPaths.length} 条`;
}
