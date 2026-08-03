import { getRepositoryTaxonomy } from "./registry";
import { matchesPath, pathSpecificity, textMentionsPath } from "./path-matcher";
import type {
  ClassificationInput,
  DomainAssessment,
  DomainDefinition,
  DomainScore,
} from "./types";

type InternalScore = DomainScore & {
  definition: DomainDefinition;
  matchedPaths: Set<string>;
  matchedTerms: Set<string>;
  matchedCodeownerRules: Set<string>;
  excludedHits: number;
};

function confidenceLabel(value: number): DomainAssessment["confidenceLabel"] {
  if (value >= 0.78) return "high";
  if (value >= 0.52) return "medium";
  return "low";
}

function countTerms(text: string, terms: string[], matched: Set<string>) {
  let count = 0;
  for (const term of terms) {
    if (!term) continue;
    const candidate = term.toLowerCase();
    const found = /^[a-z0-9]{1,3}$/.test(candidate)
      ? new RegExp(`\\b${candidate}\\b`, "i").test(text)
      : text.includes(candidate);
    if (!found) continue;
    count += 1;
    matched.add(term);
  }
  return count;
}

function numericScore(entry: Omit<InternalScore, "score">) {
  return Math.round(
    entry.sourceLines * 2 +
      entry.sourceHits * 240 +
      entry.codeownerHits * 120 +
      entry.codeownerSpecificity * 2 +
      entry.testHits * 75 +
      entry.labelHits * 45 +
      entry.linkedHits * 35 +
      entry.titleHits * 24 +
      entry.bodyHits * 6 +
      entry.definition.priority / 10 -
      entry.excludedHits * 300,
  );
}

function comparePr(left: InternalScore, right: InternalScore) {
  const leftSupport = left.sourceHits > 0 && left.testHits > 0 ? 1 : 0;
  const rightSupport = right.sourceHits > 0 && right.testHits > 0 ? 1 : 0;
  return (
    right.sourceLines - left.sourceLines ||
    right.sourceHits - left.sourceHits ||
    right.codeownerSpecificity - left.codeownerSpecificity ||
    right.codeownerHits - left.codeownerHits ||
    rightSupport - leftSupport ||
    right.titleHits - left.titleHits ||
    right.score - left.score ||
    right.definition.priority - left.definition.priority
  );
}

function compareIssue(left: InternalScore, right: InternalScore) {
  return (
    right.labelHits - left.labelHits ||
    right.sourceHits - left.sourceHits ||
    right.codeownerSpecificity - left.codeownerSpecificity ||
    right.linkedHits - left.linkedHits ||
    right.titleHits - left.titleHits ||
    right.bodyHits - left.bodyHits ||
    right.score - left.score ||
    right.definition.priority - left.definition.priority
  );
}

function publicScore(entry: InternalScore): DomainScore {
  return {
    domain: entry.domain,
    score: entry.score,
    sourceLines: entry.sourceLines,
    sourceHits: entry.sourceHits,
    codeownerHits: entry.codeownerHits,
    codeownerSpecificity: entry.codeownerSpecificity,
    testHits: entry.testHits,
    labelHits: entry.labelHits,
    titleHits: entry.titleHits,
    bodyHits: entry.bodyHits,
    linkedHits: entry.linkedHits,
  };
}

export function classifyDomain(input: ClassificationInput): DomainAssessment {
  const taxonomy = input.taxonomy ?? getRepositoryTaxonomy(input.repoId);
  const kind = input.kind ?? (input.files?.length ? "pr" : "issue");
  const title = input.title.toLowerCase();
  const body = (input.body ?? "").toLowerCase();
  const labels = (input.labels ?? []).map((label) => label.toLowerCase());
  const linkedDomains = new Set(input.linkedDomains ?? []);
  const files = input.files ?? [];

  const mostSpecificCodeowners = new Map<string, number>();
  for (const file of files) {
    let mostSpecific = 0;
    for (const domain of taxonomy.domains) {
      for (const pattern of domain.codeownerPaths) {
        if (matchesPath(file.path, pattern)) {
          mostSpecific = Math.max(mostSpecific, pathSpecificity(pattern));
        }
      }
    }
    mostSpecificCodeowners.set(file.path, mostSpecific);
  }

  const scored = taxonomy.domains.map((definition): InternalScore => {
    const base = {
      domain: definition.name,
      sourceLines: 0,
      sourceHits: 0,
      codeownerHits: 0,
      codeownerSpecificity: 0,
      testHits: 0,
      labelHits: 0,
      titleHits: 0,
      bodyHits: 0,
      linkedHits: linkedDomains.has(definition.name) ? 1 : 0,
      definition,
      matchedPaths: new Set<string>(),
      matchedTerms: new Set<string>(),
      matchedCodeownerRules: new Set<string>(),
      excludedHits: 0,
    };

    for (const file of files) {
      const changedLines = Math.max(1, Number(file.additions ?? 0) + Number(file.deletions ?? 0));
      if (definition.excludePaths.some((pattern) => matchesPath(file.path, pattern))) {
        base.excludedHits += 1;
        continue;
      }
      const sourceMatch = definition.sourcePaths.some((pattern) => matchesPath(file.path, pattern));
      const testMatch = definition.testPaths.some((pattern) => matchesPath(file.path, pattern));
      if (sourceMatch) {
        base.sourceHits += 1;
        base.sourceLines += changedLines;
        base.matchedPaths.add(file.path);
      }
      if (testMatch) {
        base.testHits += 1;
        base.matchedPaths.add(file.path);
      }
      const requiredSpecificity = mostSpecificCodeowners.get(file.path) ?? 0;
      for (const pattern of definition.codeownerPaths) {
        const specificity = pathSpecificity(pattern);
        if (
          specificity > 0 &&
          specificity === requiredSpecificity &&
          matchesPath(file.path, pattern)
        ) {
          base.codeownerHits += 1;
          base.codeownerSpecificity += specificity;
          base.matchedCodeownerRules.add(pattern);
          break;
        }
      }
    }

    if (kind === "issue") {
      const combined = `${title}\n${body}`;
      const pathMention = [...definition.sourcePaths, ...definition.codeownerPaths]
        .some((pattern) => textMentionsPath(combined, pattern));
      if (pathMention) {
        base.sourceHits += 1;
        base.matchedTerms.add("正文中的模块/路径引用");
      }
    }
    base.labelHits = definition.labelTerms.filter((term) =>
      labels.some((label) => label === term.toLowerCase() || label.includes(term.toLowerCase())),
    ).length;
    base.titleHits = countTerms(title, definition.titleTerms, base.matchedTerms);
    base.bodyHits = countTerms(body, definition.bodyTerms, base.matchedTerms);
    if (
      definition.id === "ci-infra" &&
      base.sourceHits === 0 && base.codeownerHits === 0 &&
      base.titleHits === 0 && base.labelHits === 0
    ) {
      base.bodyHits = 0;
      base.matchedTerms.clear();
    }
    return { ...base, score: numericScore(base as Omit<InternalScore, "score">) };
  });

  const technicalHasSource = scored.some((entry) => !entry.definition.fallbackOnly && entry.sourceHits > 0);
  const candidates = scored.filter((entry) => {
    if (entry.excludedHits > 0 && entry.score <= 0) return false;
    if (technicalHasSource && entry.definition.fallbackOnly) return false;
    return entry.score > 0 && (
      entry.sourceHits + entry.codeownerHits + entry.testHits + entry.labelHits +
      entry.titleHits + entry.bodyHits + entry.linkedHits > 0
    );
  });
  candidates.sort(kind === "pr" ? comparePr : compareIssue);
  const winner = candidates[0];
  if (!winner) {
    return {
      domain: taxonomy.defaultDomain,
      source: "fallback",
      confidence: 0.18,
      confidenceLabel: "low",
      matchedPaths: [],
      matchedTerms: [],
      scores: [],
      taxonomyVersion: taxonomy.version,
      matchedCodeownerRules: [],
    };
  }

  const runnerUp = candidates[1];
  const marginRatio = runnerUp ? Math.max(0, (winner.score - runnerUp.score) / Math.max(1, winner.score)) : 1;
  const hasSource = winner.sourceHits > 0;
  const hasFileEvidence = hasSource || winner.testHits > 0 || winner.codeownerHits > 0;
  const weakIssue = kind === "issue" && winner.labelHits === 0 && winner.sourceHits === 0 && winner.linkedHits === 0;
  let confidence = hasSource
    ? 0.68 + Math.min(0.2, winner.sourceHits * 0.04) + Math.min(0.09, marginRatio * 0.12)
    : hasFileEvidence
      ? 0.52 + Math.min(0.16, marginRatio * 0.2)
      : 0.34 + Math.min(0.18, marginRatio * 0.2);
  if (weakIssue) confidence = Math.min(confidence, 0.46);
  if (runnerUp && marginRatio < 0.12) confidence = Math.min(confidence, 0.5);
  confidence = Math.max(0.18, Math.min(0.97, confidence));

  return {
    domain: winner.domain,
    source: hasFileEvidence
      ? winner.titleHits + winner.bodyHits + winner.labelHits > 0
        ? "files+text"
        : "files"
      : "text",
    confidence: Number(confidence.toFixed(2)),
    confidenceLabel: confidenceLabel(confidence),
    matchedPaths: [...winner.matchedPaths].slice(0, 12),
    matchedTerms: [...winner.matchedTerms].slice(0, 12),
    scores: candidates.slice(0, 5).map(publicScore),
    taxonomyVersion: taxonomy.version,
    matchedCodeownerRules: [...winner.matchedCodeownerRules],
  };
}
