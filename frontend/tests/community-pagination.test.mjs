import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importWorkerModule } from "./helpers/import-worker-module.mjs";

const communityRepository = await importWorkerModule(
  "worker/repositories/community.ts",
);
const communityRoutes = await importWorkerModule("worker/routes/community.ts");

function recordingEnv(resultsForSql) {
  const calls = [];
  return {
    calls,
    env: {
      DB: {
        prepare(sql) {
          const statement = {
            bindings: [],
            bind(...bindings) {
              statement.bindings = bindings;
              return statement;
            },
            async all() {
              calls.push({ sql, bindings: statement.bindings });
              return { results: resultsForSql(sql) };
            },
          };
          return statement;
        },
      },
    },
  };
}

test("community repository applies server filters, Beijing bounds and number ordering", async () => {
  const { env, calls } = recordingEnv(() => []);
  await communityRepository.listCommunityRows(env, {
    repo: "vllm-ascend",
    kind: "pr",
    domain: "Attention",
    state: "open",
    search: "50%_case",
    updatedFrom: "2026-08-03T16:00:00.000Z",
    updatedBefore: "2026-08-04T16:00:00.000Z",
    sort: "number",
    limit: 100,
    offset: 200,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /repo_id = \?/);
  assert.match(calls[0].sql, /kind = \?/);
  assert.match(calls[0].sql, /domain = \?/);
  assert.match(calls[0].sql, /state = \?/);
  assert.match(calls[0].sql, /updated_at >= \?/);
  assert.match(calls[0].sql, /updated_at < \?/);
  assert.match(calls[0].sql, /ai_summary LIKE \?/);
  assert.match(calls[0].sql, /CAST\(number AS TEXT\) LIKE \?/);
  assert.match(calls[0].sql, /ORDER BY number DESC, updated_at DESC, id DESC/);
  assert.deepEqual(calls[0].bindings.slice(0, 6), [
    "vllm-ascend",
    "pr",
    "Attention",
    "open",
    "2026-08-03T16:00:00.000Z",
    "2026-08-04T16:00:00.000Z",
  ]);
  assert.deepEqual(calls[0].bindings.slice(-2), [100, 200]);
  assert.equal(calls[0].bindings[6], "%50\\%\\_case%");
});

test("community route converts inclusive Beijing dates and returns the true total", async () => {
  assert.deepEqual(
    communityRoutes.beijingDateRangeToUtc("2026-08-04", "2026-08-04"),
    {
      updatedFrom: "2026-08-03T16:00:00.000Z",
      updatedBefore: "2026-08-04T16:00:00.000Z",
    },
  );
  assert.deepEqual(communityRoutes.beijingDateRangeToUtc("bad", "2026-02-30"), {
    updatedFrom: null,
    updatedBefore: null,
  });

  const { env, calls } = recordingEnv((sql) => {
    if (sql.includes("COUNT(*)")) return [{ total: 237 }];
    if (sql.includes("SELECT DISTINCT domain")) {
      return [{ domain: "Attention" }, { domain: "Other" }];
    }
    return [{
      id: "vllm-ascend:pr:13001",
      repo_id: "vllm-ascend",
      kind: "pr",
      number: 13001,
      state: "open",
      title: "Update attention backend",
      author: "maintainer",
      body_md: "Body",
      domain: "Attention",
      ai_summary: "Summary",
      status_text: "Review required",
      updated_at: "2026-08-04T08:00:00.000Z",
      fetched_at: "2026-08-04T08:05:00.000Z",
    }];
  });

  const response = await communityRoutes.listCommunity(
    new Request(
      "http://localhost/api/community?repo=vllm-ascend&kind=pr&from=2026-08-04&to=2026-08-04&sort=number&limit=100&offset=200",
    ),
    env,
  );
  const payload = await response.json();

  assert.equal(payload.total, 237);
  assert.equal(payload.limit, 100);
  assert.equal(payload.offset, 200);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].number, 13001);
  assert.deepEqual(payload.domains, ["Attention", "Other"]);
  const listCall = calls.find((call) => call.sql.includes("community_items.*"));
  assert.match(listCall.sql, /ORDER BY number DESC/);
  assert.ok(calls.some((call) => call.sql.includes("COUNT(*) AS total")));
});

test("community workspace requests one 100-row page and keeps watchlist data separate", () => {
  const workspace = readFileSync("src/composables/useCommunityWorkspace.ts", "utf8");
  const communityApi = readFileSync("src/api/community.ts", "utf8");
  assert.match(workspace, /communityApi\.communityPage\(communityPageQuery/);
  assert.match(workspace, /limit: COMMUNITY_PAGE_SIZE/);
  assert.match(workspace, /offset: \(currentPage\.value - 1\) \* COMMUNITY_PAGE_SIZE/);
  assert.match(workspace, /watchlistItems\.value = watchItems\.map/);
  assert.doesNotMatch(workspace, /communityApi\.communityAll/);
  assert.doesNotMatch(communityApi, /for \(let offset = 0;/);
});
