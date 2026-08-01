import { query, type WorkerEnv } from "../db";

export interface RepositorySummary {
  id: string;
  owner: string;
  name: string;
  openPulls: number;
  openIssues: number;
  lastSyncedAt: string | null;
  syncStatus: string | null;
}

export async function listEnabledRepositories(
  env: WorkerEnv,
): Promise<RepositorySummary[]> {
  const rows = await query<Record<string, unknown>>(
    env,
    "SELECT * FROM repositories WHERE enabled = 1 ORDER BY id",
  );

  return rows.map((row) => ({
    id: String(row.id),
    owner: String(row.owner),
    name: String(row.name),
    openPulls: Number(row.open_pull_count ?? 0),
    openIssues: Number(row.open_issue_count ?? 0),
    lastSyncedAt:
      typeof row.last_synced_at === "string" ? row.last_synced_at : null,
    syncStatus: typeof row.sync_status === "string" ? row.sync_status : null,
  }));
}
