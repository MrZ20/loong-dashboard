import { generateDomainMapDocument } from "../ai";
import type { WorkerEnv } from "../db";
import { parseJson } from "../mappers/database-row";
import {
  architectureMatchesDomain,
  architectureTaxonomyDomains,
  DOMAIN_ARCHITECTURES,
} from "../domain/architecture-catalog";
import {
  architectureMarkdown,
  architectureStages,
  domainSlug,
  domainSnapshotFallback,
  executionNodes,
} from "../domain/domain-map";
import {
  listDomainActivityRows,
  listDomainEventRows,
  listDomainSnapshotRows,
  saveDomainSnapshot,
} from "../repositories/domain-maps";
import { beijingDate, beijingDayWindow } from "../time";
import { resolveAITask } from "./ai-task-settings";
import { enqueueManagedAITask } from "./local-runtime/enqueue";

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function changedPathsFor(items: Record<string, any>[]) {
  return unique(
    items.flatMap((item) => {
      const diff = parseJson<Record<string, any> | null>(item.diff_json, null);
      return (diff?.entries ?? [])
        .map((entry: Record<string, any>) => entry.path)
        .filter((path: unknown): path is string => typeof path === "string" && Boolean(path));
    }),
  );
}

function mapSnapshot(snapshot: Record<string, any> | undefined) {
  if (!snapshot) return null;
  return {
    date: snapshot.snapshot_date,
    architectureMd: snapshot.architecture_md,
    insightMd: snapshot.insight_md,
    changedPaths: parseJson(snapshot.changed_paths_json, []),
    promptTemplateId: snapshot.prompt_template_id ?? null,
    promptTemplateName: snapshot.prompt_template_name ?? "",
    promptRevision: Number(snapshot.prompt_revision ?? 0),
    promptVersion: snapshot.prompt_version ?? "",
    model: snapshot.model ?? "",
    provider: snapshot.provider ?? "",
    generationSource: snapshot.generation_source ?? "rules",
    createdAt: snapshot.created_at,
  };
}

export async function listDomains(env: WorkerEnv) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayWindow = beijingDayWindow();
  const [activityRows, eventRows, snapshots] = await Promise.all([
    listDomainActivityRows(env, cutoff),
    listDomainEventRows(env, todayWindow.start, todayWindow.end),
    listDomainSnapshotRows(env),
  ]);
  const latestSnapshotByDomain = new Map<string, Record<string, any>>();
  for (const snapshot of snapshots) {
    if (!latestSnapshotByDomain.has(snapshot.domain)) latestSnapshotByDomain.set(snapshot.domain, snapshot);
  }
  const latestEventByItem = new Map<string, Record<string, any>>();
  for (const row of eventRows) {
    if (!latestEventByItem.has(row.item_id)) latestEventByItem.set(row.item_id, row);
  }
  const todayItems = [...latestEventByItem.values()];

  return Object.entries(DOMAIN_ARCHITECTURES).map(([domain, architecture]) => {
    const matchedActivity = activityRows.filter((row) =>
      architectureMatchesDomain(architecture, row.repo_id, row.domain));
    const changes = todayItems.filter((item) =>
      architectureMatchesDomain(architecture, item.repo_id, item.domain));
    const changedPaths = changedPathsFor(changes);
    const pulls = matchedActivity.reduce((total, row) => total + Number(row.pulls ?? 0), 0);
    const issues = matchedActivity.reduce((total, row) => total + Number(row.issues ?? 0), 0);
    const risks = matchedActivity.reduce((total, row) => total + Number(row.risks ?? 0), 0);
    const latestChange = matchedActivity.reduce<string | null>((latest, row) => {
      if (!row.latest_change) return latest;
      return !latest || row.latest_change > latest ? row.latest_change : latest;
    }, null);
    const signalCount = pulls + issues;
    const mappedChanges = changes.map((item) => ({
      id: item.item_id,
      eventId: item.event_id,
      eventType: item.event_type,
      repo: item.repo_id,
      kind: item.kind,
      number: Number(item.number),
      title: item.title,
      updatedAt: item.updated_at,
      occurredAt: item.occurred_at,
    }));
    return {
      id: domainSlug(domain),
      name: domain,
      description: architecture.description,
      pipeline: architecture.pipeline,
      taxonomyDomains: architectureTaxonomyDomains(architecture),
      architecture: {
        source: "maintained-baseline",
        executionFlow: executionNodes(architecture.pipeline),
        updatedByDailyActivity: false,
      },
      stages: architectureStages(architecture),
      activity: {
        window: "7d",
        pulls,
        issues,
        risks,
        trend: signalCount >= 5 ? "升温" : signalCount >= 2 ? "稳定" : "低活跃",
        latestChange,
      },
      today: {
        date: todayWindow.date,
        timezone: todayWindow.timezone,
        changedPaths,
        changes: mappedChanges,
      },
      snapshot: mapSnapshot(latestSnapshotByDomain.get(domain)),
    };
  });
}

export async function createDailyDomainSnapshot(
  env: WorkerEnv,
  userId: string,
  domain: string,
) {
  const map = (await listDomains(env)).find((item) => item.name === domain);
  const architecture = DOMAIN_ARCHITECTURES[domain];
  if (!map || !architecture) return null;
  const now = new Date().toISOString();
  const date = beijingDate();
  const evidence = JSON.stringify({
    architectureBaseline: {
      domain,
      description: architecture.description,
      taxonomyDomains: map.taxonomyDomains,
      executionFlow: map.architecture.executionFlow,
      stages: map.stages,
    },
    today: map.today,
    recentActivityContext: map.activity,
    evidenceLimitations: [
      "架构基线来自 LoongBoard 维护配置，不等于当前 Commit 的源码验证。",
      "today 只包含数据库中北京时间当日已同步的社区事件。",
    ],
  }, null, 2);
  const task = await resolveAITask(env, userId, "domain_architecture_map");
  if (task.executionMode !== "api") {
    const job = await enqueueManagedAITask(env, {
      userId,
      taskKey: "domain_architecture_map",
      purpose: "domain_snapshot",
      subjectKind: "domain",
      subjectKey: `${domain}:${date}`,
      repoScope: "all",
      request: {
        evidence,
        snapshot: {
          id: `domain-${domainSlug(domain)}-${date}`,
          domain,
          date,
          architectureMd: architectureMarkdown(domain),
          changedPaths: map.today.changedPaths,
          activity: { recent: map.activity, today: map.today },
        },
      },
    });
    return { job, snapshot: null };
  }
  const generated = await generateDomainMapDocument(env, {
    userId,
    domain,
    date,
    evidence,
    fallback: domainSnapshotFallback(domain, date, map),
  });
  const snapshot = await saveDomainSnapshot(env, {
    id: `domain-${domainSlug(domain)}-${date}`,
    domain,
    date,
    architectureMd: architectureMarkdown(domain),
    changedPaths: map.today.changedPaths,
    activity: { recent: map.activity, today: map.today },
    insightMd: generated.content,
    promptTemplateId: generated.prompt.templateId,
    promptTemplateName: generated.prompt.name,
    promptRevision: generated.prompt.revision,
    promptVersion: generated.prompt.promptVersion,
    model: generated.model,
    provider: generated.providerName,
    generationSource: generated.provider,
    createdAt: now,
  });
  return { job: null, snapshot };
}
