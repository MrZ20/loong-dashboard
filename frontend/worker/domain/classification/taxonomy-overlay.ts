import type {
  RepositoryTaxonomy,
  TaxonomyDomainOverlay,
  TaxonomyOverlay,
} from "./types";

function cleanList(value: unknown, kind: "path" | "term") {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const cleaned = entry.trim().slice(0, 240);
    if (!cleaned) return [];
    if (kind === "path" && (
      cleaned.startsWith("/") || cleaned.includes("..") ||
      cleaned.includes("://") || /(?:^|\/)\.env(?:$|\/)/.test(cleaned)
    )) return [];
    return [cleaned];
  }))].slice(0, 30);
}

export function validateTaxonomyOverlay(
  payload: unknown,
  taxonomy: RepositoryTaxonomy,
): TaxonomyOverlay {
  const source = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const registered = new Set(taxonomy.domains.map((domain) => domain.id));
  const domains = (Array.isArray(source.domains) ? source.domains : []).flatMap(
    (entry): TaxonomyDomainOverlay[] => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      if (!registered.has(id)) return [];
      return [{
        id,
        sourcePaths: cleanList(row.sourcePaths, "path"),
        testPaths: cleanList(row.testPaths, "path"),
        codeownerPaths: cleanList(row.codeownerPaths, "path"),
        titleTerms: cleanList(row.titleTerms, "term"),
        bodyTerms: cleanList(row.bodyTerms, "term"),
        labelTerms: cleanList(row.labelTerms, "term"),
        excludePaths: cleanList(row.excludePaths, "path"),
        rationale: typeof row.rationale === "string"
          ? row.rationale.slice(0, 1_000)
          : "",
      }];
    },
  );
  const proposals = (Array.isArray(source.newDomainProposals)
    ? source.newDomainProposals
    : []).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.name !== "string") return [];
      return [{
        id: row.id.slice(0, 80),
        name: row.name.slice(0, 120),
        rationale: typeof row.rationale === "string"
          ? row.rationale.slice(0, 1_500)
          : "",
        evidence: cleanList(row.evidence, "term").slice(0, 12),
      }];
    }).slice(0, 10);
  return {
    version: `refresh-${new Date().toISOString()}`,
    domains,
    newDomainProposals: proposals,
  };
}
