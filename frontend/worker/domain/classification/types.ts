export type RepositoryTaxonomyId = "vllm" | "vllm-ascend";

export type ClassificationSource =
  | "files"
  | "files+text"
  | "text"
  | "fallback"
  | "ai";

export interface DomainDefinition {
  id: string;
  name: string;
  description: string;
  sourcePaths: string[];
  testPaths: string[];
  codeownerPaths: string[];
  titleTerms: string[];
  bodyTerms: string[];
  labelTerms: string[];
  excludePaths: string[];
  competingDomains: string[];
  priority: number;
  conflictResolution: string;
  examples: string[];
  fallbackOnly?: boolean;
  e2eCoverageTerms?: string[];
}

export interface RepositoryTaxonomy {
  repoId: RepositoryTaxonomyId;
  name: string;
  version: string;
  evidenceRevision: string;
  defaultDomain: "Other";
  domains: DomainDefinition[];
}

export interface ClassificationFile {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface ClassificationInput {
  repoId?: string;
  kind?: "pr" | "issue";
  title: string;
  body?: string;
  files?: ClassificationFile[];
  labels?: string[];
  linkedDomains?: string[];
  taxonomy?: RepositoryTaxonomy;
}

export interface DomainScore {
  domain: string;
  score: number;
  sourceLines: number;
  sourceHits: number;
  codeownerHits: number;
  codeownerSpecificity: number;
  testHits: number;
  labelHits: number;
  titleHits: number;
  bodyHits: number;
  linkedHits: number;
}

export interface DomainAssessment {
  domain: string;
  source: ClassificationSource;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  matchedPaths: string[];
  matchedTerms: string[];
  scores: DomainScore[];
  taxonomyVersion: string;
  matchedCodeownerRules: string[];
}

export interface TaxonomyDomainOverlay {
  id: string;
  sourcePaths?: string[];
  testPaths?: string[];
  codeownerPaths?: string[];
  titleTerms?: string[];
  bodyTerms?: string[];
  labelTerms?: string[];
  excludePaths?: string[];
  rationale?: string;
}

export interface TaxonomyOverlay {
  version: string;
  domains: TaxonomyDomainOverlay[];
  newDomainProposals?: Array<{
    id: string;
    name: string;
    rationale: string;
    evidence: string[];
  }>;
}
