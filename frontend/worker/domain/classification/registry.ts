import type {
  DomainDefinition,
  RepositoryTaxonomy,
  RepositoryTaxonomyId,
  TaxonomyOverlay,
} from "./types";
import { VLLM_TAXONOMY } from "./taxonomies/vllm";
import { VLLM_ASCEND_TAXONOMY } from "./taxonomies/vllm-ascend";

const TAXONOMIES: Record<RepositoryTaxonomyId, RepositoryTaxonomy> = {
  vllm: VLLM_TAXONOMY,
  "vllm-ascend": VLLM_ASCEND_TAXONOMY,
};

export function normalizeRepositoryTaxonomyId(value?: string): RepositoryTaxonomyId {
  return value === "vllm-ascend" ? "vllm-ascend" : "vllm";
}

export function getRepositoryTaxonomy(repoId?: string) {
  return TAXONOMIES[normalizeRepositoryTaxonomyId(repoId)];
}

function unique(values: string[] | undefined, current: string[]) {
  return [...new Set([...current, ...(values ?? [])].map((value) => value.trim()).filter(Boolean))];
}

export function applyTaxonomyOverlay(
  taxonomy: RepositoryTaxonomy,
  overlay?: TaxonomyOverlay | null,
): RepositoryTaxonomy {
  if (!overlay?.domains?.length) return taxonomy;
  const additions = new Map(overlay.domains.map((domain) => [domain.id, domain]));
  const domains = taxonomy.domains.map((domain): DomainDefinition => {
    const extra = additions.get(domain.id);
    if (!extra) return domain;
    return {
      ...domain,
      sourcePaths: unique(extra.sourcePaths, domain.sourcePaths),
      testPaths: unique(extra.testPaths, domain.testPaths),
      codeownerPaths: unique(extra.codeownerPaths, domain.codeownerPaths),
      titleTerms: unique(extra.titleTerms, domain.titleTerms),
      bodyTerms: unique(extra.bodyTerms, domain.bodyTerms),
      labelTerms: unique(extra.labelTerms, domain.labelTerms),
      excludePaths: unique(extra.excludePaths, domain.excludePaths),
    };
  });
  return {
    ...taxonomy,
    version: `${taxonomy.version}+${overlay.version}`,
    domains,
  };
}

export function listRepositoryTaxonomies() {
  return Object.values(TAXONOMIES);
}
