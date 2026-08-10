import type { CommunityKind } from "./community";
import type { RepositoryId } from "./core";

export interface DomainMapStage {
  label: string;
  repository: string;
  responsibility?: string;
  paths: string[];
  symbols: string[];
}

export interface TechnicalDocument {
  id: string;
  category: string;
  slug: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DomainMapApi {
  id: string;
  name: string;
  description: string;
  pipeline: string;
  taxonomyDomains: {
    vllm: string[];
    "vllm-ascend": string[];
  };
  architecture: {
    source: "maintained-baseline";
    executionFlow: Array<{
      id: string;
      label: string;
      order: number;
    }>;
    updatedByDailyActivity: false;
  };
  stages: DomainMapStage[];
  activity: {
    window: "7d";
    pulls: number;
    issues: number;
    risks: number;
    trend: string;
    latestChange: string | null;
  };
  today: {
    date: string;
    timezone: "Asia/Shanghai";
    changedPaths: string[];
    changes: Array<{
      id: string;
      eventId: string;
      eventType: string;
      repo: RepositoryId;
      kind: CommunityKind;
      number: number;
      title: string;
      updatedAt: string;
      occurredAt: string;
    }>;
  };
  snapshot: {
    date: string;
    architectureMd: string;
    insightMd: string;
    changedPaths: string[];
    promptTemplateId: string | null;
    promptTemplateName: string;
    promptRevision: number;
    promptVersion: string;
    model: string;
    provider: string;
    generationSource: "api" | "fallback" | "rules" | string;
    createdAt: string;
  } | null;
}
