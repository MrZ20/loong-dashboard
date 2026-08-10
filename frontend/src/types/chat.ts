export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  contentMd: string;
  context?: Record<string, unknown>;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  title: string;
  context?: Record<string, unknown>;
  mode?: "normal" | "repository";
  repoScope?: string;
  targetRef?: string;
  providerId?: string;
  modelId?: string;
  engineId?: LocalAgentEngine;
  agentSessionId?: string | null;
  agentCommitSha?: string;
  runnerJobId?: string | null;
  localEvidence?: boolean;
  createdAt: string;
  updatedAt: string;
}
import type { LocalAgentEngine } from "../../shared/contracts/local-agent";
