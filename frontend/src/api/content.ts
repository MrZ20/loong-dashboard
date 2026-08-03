import type {
  AnalysisDocument,
  DomainMapApi,
  LocalAnalysisJob,
  TechnicalDocument,
} from "../types";
import { apiFetch } from "./core";

export const contentApi = {
  analyses: async (type?: string, scope?: string) => {
    const search = new URLSearchParams();
    if (type) search.set("type", type);
    if (scope) search.set("scope", scope);
    const result = await apiFetch<{ analyses: AnalysisDocument[] }>(
      `/api/analyses${search.size ? `?${search}` : ""}`,
    );
    return result.analyses;
  },

  analysis: async (id: string) => {
    const result = await apiFetch<{ analysis: AnalysisDocument }>(
      `/api/analyses/${encodeURIComponent(id)}`,
    );
    return result.analysis;
  },

  generateAnalysis: (
    input: {
      type: string;
      scope: string;
      title?: string;
      useLocalCode?: boolean;
      targets?: unknown[];
      providerId?: string;
      modelId?: string;
    },
  ) =>
    apiFetch<{ analysis?: AnalysisDocument; provider?: string; job?: LocalAnalysisJob }>(
      "/api/analyses/generate",
      { method: "POST", body: JSON.stringify(input) },
    ),

  domains: async () => {
    const result = await apiFetch<{ domains: DomainMapApi[] }>("/api/domains");
    return result.domains;
  },

  createDomainSnapshot: (domain: string) =>
    apiFetch<{ snapshot: unknown | null; job?: LocalAnalysisJob | null }>(
      `/api/domains/${encodeURIComponent(domain)}/snapshot`,
      { method: "POST" },
    ),

  documents: async (category?: string) => {
    const search = category
      ? `?category=${encodeURIComponent(category)}`
      : "";
    const result = await apiFetch<{ documents: TechnicalDocument[] }>(
      `/api/documents${search}`,
    );
    return result.documents;
  },

  generateDocumentDraft: (input: {
    title: string;
    category: string;
    summary: string;
    contentMd: string;
    tags: string[];
    sourceRefs: string[];
  }) =>
    apiFetch<{
      draft?: { contentMd: string; summary: string };
      provider?: string;
      job?: LocalAnalysisJob;
    }>("/api/documents/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  saveDocument: (
    input: Partial<TechnicalDocument> &
      Pick<TechnicalDocument, "title" | "category" | "contentMd">,
  ) =>
    apiFetch<{ document: TechnicalDocument }>("/api/documents", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateDocument: (id: string, input: Partial<TechnicalDocument>) =>
    apiFetch<{ document: TechnicalDocument }>(
      `/api/documents/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),

};
