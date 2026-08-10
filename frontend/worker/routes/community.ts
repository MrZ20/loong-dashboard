import { requireUser } from "../auth";
import type { WorkerEnv } from "../db";
import { mapAnalysis } from "../mappers/analysis";
import { mapCommunityItem } from "../mappers/community-item";
import { ensurePullPatches } from "../services/pull-details";
import { sanitizeUserAnalysisRequirement } from "../domain/analysis-quality";
import { getRepositoryTaxonomy } from "../domain/classification/registry";
import {
  HttpError,
  json,
  readJson,
} from "../http";
import {
  countCommunityRows,
  findCommunityRow,
  listCommunityAnalysisRows,
  listCommunityDomains,
  listCommunityRows,
} from "../repositories/community";
import { startCommunityDeepAnalysis } from "../services/local-runtime/enqueue";
import { withUserGithubToken } from "../services/github-settings";

function beijingDateBoundary(value: string | null, nextDay = false) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) return null;
  return new Date(
    Date.UTC(year, month - 1, day + (nextDay ? 1 : 0)) - 8 * 60 * 60 * 1_000,
  ).toISOString();
}

export function beijingDateRangeToUtc(from: string | null, to: string | null) {
  return {
    updatedFrom: beijingDateBoundary(from),
    updatedBefore: beijingDateBoundary(to, true),
  };
}

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 0), maximum);
}

export async function listCommunity(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo");
  const kindValue = url.searchParams.get("kind");
  const kind =
    kindValue === "pr" || kindValue === "issue" ? kindValue : null;
  const domain = url.searchParams.get("domain");
  const stateValue = url.searchParams.get("state");
  const state = ["open", "draft", "merged", "closed", "reopened"].includes(
    stateValue ?? "",
  )
    ? stateValue as "open" | "draft" | "merged" | "closed" | "reopened"
    : null;
  const search = url.searchParams.get("q")?.trim();
  const dateRange = beijingDateRangeToUtc(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const sort = url.searchParams.get("sort") === "number" ? "number" : "updated";
  const limit = Math.max(
    1,
    boundedInteger(url.searchParams.get("limit"), 100, 100),
  );
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 1_000_000);

  const query = {
    repo,
    kind,
    domain,
    state,
    search,
    updatedFrom: dateRange.updatedFrom,
    updatedBefore: dateRange.updatedBefore,
    sort,
    limit,
    offset,
  } as const;
  const [rows, total, domains] = await Promise.all([
    listCommunityRows(env, query),
    countCommunityRows(env, query),
    listCommunityDomains(env, query),
  ]);
  const domainDefinitions = new Map(
    getRepositoryTaxonomy(repo ?? undefined).domains.map((definition) => [
      definition.name,
      definition,
    ]),
  );
  return json({
    items: rows.map((row) => mapCommunityItem(row)),
    total,
    limit,
    offset,
    domains,
    domainOptions: domains.map((domain) => ({
      value: domain,
      label: domain,
      description:
        domainDefinitions.get(domain)?.description ??
        "该领域来自当前仓库已同步的分类结果。",
    })),
  });
}

export async function getCommunityItem(
  request: Request,
  env: WorkerEnv,
  repo: string,
  kind: string,
  numberValue: string,
) {
  const number = Number(numberValue);
  if (!Number.isInteger(number)) throw new HttpError(400, "编号不正确");
  const item = await findCommunityRow(env, repo, kind, number);
  if (!item) throw new HttpError(404, "社区条目不存在");

  const analyses = await listCommunityAnalysisRows(
    env,
    kind,
    `${repo}:${kind}:${number}`,
  );
  return json({
    item: mapCommunityItem(
      item,
      kind === "pr" ? "stats" : "none",
    ),
    analyses: analyses.map(mapAnalysis),
  });
}

export async function getCommunityDiffFiles(
  request: Request,
  env: WorkerEnv,
  repo: string,
  numberValue: string,
) {
  const user = await requireUser(request, env);
  const number = Number(numberValue);
  if (!Number.isInteger(number)) throw new HttpError(400, "编号不正确");
  return json(await ensurePullPatches(
    await withUserGithubToken(env, user.id),
    repo,
    number,
  ));
}

export async function analyzeItem(
  request: Request,
  env: WorkerEnv,
  repo: string,
  kind: string,
  numberValue: string,
) {
  const user = await requireUser(request, env);
  const number = Number(numberValue);
  if (!Number.isInteger(number)) throw new HttpError(400, "编号不正确");
  if (kind !== "pr" && kind !== "issue") throw new HttpError(400, "条目类型不正确");
  const requestBody = await readJson<Record<string, unknown>>(request);
  const result = await startCommunityDeepAnalysis(env, {
    userId: user.id,
    repo,
    kind,
    number,
    userRequirement: sanitizeUserAnalysisRequirement(requestBody.requirement),
  });
  return json(
    {
      job: result.job,
      analysis: result.analysis ? mapAnalysis(result.analysis) : null,
    },
    { status: result.job ? 202 : 201 },
  );
}
