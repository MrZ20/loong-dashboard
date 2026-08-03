import { requireUser } from "../auth";
import {
  mapAnalysis,
  mapCommunityItem,
  type WorkerEnv,
} from "../db";
import { ensurePullPatches } from "../github";
import { sanitizeUserAnalysisRequirement } from "../domain/analysis-quality";
import {
  HttpError,
  json,
  readJson,
} from "../http";
import {
  findCommunityRow,
  listCommunityAnalysisRows,
  listCommunityRows,
} from "../repositories/community";
import { startCommunityDeepAnalysis } from "../services/local-analysis";
import { withUserGithubToken } from "../services/github-settings";

function toIsoDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export async function listCommunity(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo");
  const kindValue = url.searchParams.get("kind");
  const kind =
    kindValue === "pr" || kindValue === "issue" ? kindValue : null;
  const domain = url.searchParams.get("domain");
  const state = url.searchParams.get("state");
  const search = url.searchParams.get("q")?.trim();
  const since = toIsoDate(url.searchParams.get("since"));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 200);
  const offset = Math.min(
    Math.max(Number(url.searchParams.get("offset") || 0), 0),
    1_000_000,
  );

  const rows = await listCommunityRows(env, {
    repo,
    kind,
    domain,
    state,
    search,
    since,
    limit,
    offset,
  });
  return json({
    items: rows.map((row) => mapCommunityItem(row)),
    total: rows.length,
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
