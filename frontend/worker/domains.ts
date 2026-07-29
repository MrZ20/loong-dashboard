import { first, parseJson, query, run, type WorkerEnv } from "./db";
import { DOMAIN_ARCHITECTURES } from "./seed";

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function architectureMarkdown(domain: string) {
  const architecture = DOMAIN_ARCHITECTURES[domain];
  if (!architecture) return `# ${domain}\n\n尚未建立代码架构基线。`;
  return `# ${domain} 代码架构

${architecture.description}

## 执行链

\`${architecture.pipeline}\`

## vLLM 上游核心

${architecture.upstreamPaths.map((path) => `- \`${path}\``).join("\n")}

## Ascend 适配层

${architecture.ascendPaths.map((path) => `- \`${path}\``).join("\n")}

## 验证入口

${architecture.testPaths.map((path) => `- \`${path}\``).join("\n")}

## 关键符号

${architecture.symbols.map((symbol) => `- \`${symbol}\``).join("\n")}`;
}

export async function listDomains(env: WorkerEnv) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const activityRows = await query<Record<string, any>>(
    env,
    `SELECT domain,
      SUM(CASE WHEN kind = 'pr' THEN 1 ELSE 0 END) AS pulls,
      SUM(CASE WHEN kind = 'issue' THEN 1 ELSE 0 END) AS issues,
      SUM(CASE WHEN important = 1 THEN 1 ELSE 0 END) AS risks,
      MAX(updated_at) AS latest_change
     FROM community_items
     WHERE updated_at >= ?
     GROUP BY domain`,
    [cutoff],
  );
  const recentItems = await query<Record<string, any>>(
    env,
    `SELECT id, repo_id, kind, number, title, domain, updated_at, diff_json
     FROM community_items
     WHERE updated_at >= ?
     ORDER BY updated_at DESC
     LIMIT 200`,
    [cutoff],
  );
  const snapshots = await query<Record<string, any>>(
    env,
    `SELECT * FROM domain_snapshots ORDER BY snapshot_date DESC, created_at DESC`,
  );

  const activityByDomain = new Map(activityRows.map((row) => [row.domain, row]));
  const latestSnapshotByDomain = new Map<string, Record<string, any>>();
  for (const snapshot of snapshots) {
    if (!latestSnapshotByDomain.has(snapshot.domain)) {
      latestSnapshotByDomain.set(snapshot.domain, snapshot);
    }
  }

  return Object.entries(DOMAIN_ARCHITECTURES).map(([domain, architecture]) => {
    const activity = activityByDomain.get(domain);
    const changes = recentItems.filter((item) => item.domain === domain);
    const changedPaths = unique(
      changes.flatMap((item) => {
        const diff = parseJson<any>(item.diff_json, null);
        return (diff?.entries ?? []).map((entry: any) => entry.path);
      }),
    );
    const snapshot = latestSnapshotByDomain.get(domain);
    const signalCount =
      Number(activity?.pulls ?? 0) + Number(activity?.issues ?? 0);
    return {
      id: slugify(domain),
      name: domain,
      description: architecture.description,
      pipeline: architecture.pipeline,
      stages: [
        {
          label: "vLLM 上游核心",
          repository: "vllm",
          paths: architecture.upstreamPaths,
          symbols: architecture.symbols.slice(0, 2),
        },
        {
          label: "Ascend 适配层",
          repository: "vllm-ascend",
          paths: architecture.ascendPaths,
          symbols: architecture.symbols.slice(2),
        },
        {
          label: "验证与测试",
          repository: "tests",
          paths: architecture.testPaths,
          symbols: ["correctness", "performance", "stability"],
        },
      ],
      activity: {
        pulls: Number(activity?.pulls ?? 0),
        issues: Number(activity?.issues ?? 0),
        risks: Number(activity?.risks ?? 0),
        trend: signalCount >= 5 ? "升温" : signalCount >= 2 ? "稳定" : "低活跃",
        latestChange: activity?.latest_change ?? null,
      },
      changedPaths,
      changes: changes.map((item) => ({
        id: item.id,
        repo: item.repo_id,
        kind: item.kind,
        number: Number(item.number),
        title: item.title,
        updatedAt: item.updated_at,
      })),
      snapshot: snapshot
        ? {
            date: snapshot.snapshot_date,
            architectureMd: snapshot.architecture_md,
            insightMd: snapshot.insight_md,
            changedPaths: parseJson(snapshot.changed_paths_json, []),
          }
        : null,
    };
  });
}

export async function createDailyDomainSnapshot(
  env: WorkerEnv,
  domain: string,
  insightMd = "",
) {
  const maps = await listDomains(env);
  const map = maps.find((item) => item.name === domain);
  if (!map) return null;
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const id = `domain-${slugify(domain)}-${date}`;
  const insight =
    insightMd ||
    `# ${domain} 每日变化

过去 7 天发现 **${map.activity.pulls} 个 PR**、**${map.activity.issues} 个 Issue**，其中 **${map.activity.risks} 项**被标记为重点。

## 活跃路径

${map.changedPaths.length
  ? map.changedPaths.map((path) => `- \`${path}\``).join("\n")
  : "- 暂无已同步的代码路径变化"}

## 说明

代码架构基线保持稳定；“活跃路径”和“社区变化”会随着 GitHub 同步每日更新。`;

  await run(
    env,
    `INSERT INTO domain_snapshots (
      id, domain, snapshot_date, architecture_md, changed_paths_json,
      activity_json, insight_md, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain, snapshot_date) DO UPDATE SET
      changed_paths_json = excluded.changed_paths_json,
      activity_json = excluded.activity_json,
      insight_md = excluded.insight_md,
      created_at = excluded.created_at`,
    [
      id,
      domain,
      date,
      architectureMarkdown(domain),
      JSON.stringify(map.changedPaths),
      JSON.stringify(map.activity),
      insight,
      now,
    ],
  );

  return first<Record<string, any>>(
    env,
    "SELECT * FROM domain_snapshots WHERE id = ?",
    [id],
  );
}
