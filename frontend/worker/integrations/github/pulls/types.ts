import type { PullReviewFacts } from "../../../domain/review-signals";

export type IncrementalWindow = {
  boundary: string | null;
  initialCutoff: string;
};

export type PullFileStat = {
  path: string;
  additions: number;
  deletions: number;
};

export type PullSyncDiff = {
  files: number;
  additions: number;
  deletions: number;
  entries: PullFileStat[];
  source: "graphql-files";
  complete: boolean;
  endCursor: string | null;
  statsOnly: true;
  notice: string;
};

export type PullSyncSnapshot = {
  item: Record<string, any>;
  diff: PullSyncDiff;
  reviewFacts: PullReviewFacts;
};
