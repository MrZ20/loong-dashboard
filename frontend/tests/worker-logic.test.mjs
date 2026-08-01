import assert from "node:assert/strict";
import { build } from "esbuild";
import test from "node:test";

async function importWorkerModule(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const timeModule = await importWorkerModule("worker/time.ts");
const dbModule = await importWorkerModule("worker/db.ts");
const githubModule = await importWorkerModule("worker/github.ts");
const intelligenceModule = await importWorkerModule("worker/intelligence.ts");
const routeManifestModule = await importWorkerModule("worker/routes/manifest.ts");

test("uses Beijing natural-day boundaries independent of server timezone", () => {
  assert.equal(
    timeModule.beijingDate(new Date("2026-07-29T15:59:59.999Z")),
    "2026-07-29",
  );
  assert.equal(
    timeModule.beijingDate(new Date("2026-07-29T16:00:00.000Z")),
    "2026-07-30",
  );
  assert.deepEqual(timeModule.beijingDayWindow("2026-07-30"), {
    date: "2026-07-30",
    start: "2026-07-29T16:00:00.000Z",
    end: "2026-07-30T16:00:00.000Z",
    timezone: "Asia/Shanghai",
  });
});

test("initializes a migrated D1 binding only once per worker isolate", async () => {
  let schemaChecks = 0;
  let writes = 0;
  const requiredTables = [
    "app_meta",
    "users",
    "user_profiles",
    "ai_providers",
    "repositories",
    "community_items",
    "community_events",
    "cross_repo_impacts",
    "watchlist",
    "analysis_documents",
    "domain_snapshots",
    "technical_documents",
    "chat_threads",
    "chat_messages",
    "sync_runs",
  ];
  const db = {
    prepare(sql) {
      const statement = {
        bind() {
          return statement;
        },
        async all() {
          if (sql.includes("sqlite_master")) {
            schemaChecks += 1;
            return { results: requiredTables.map((name) => ({ name })) };
          }
          if (sql.includes("SELECT value FROM app_meta")) {
            return { results: [{ value: "3" }] };
          }
          return { results: [] };
        },
        async run() {
          writes += 1;
          return { success: true };
        },
      };
      return statement;
    },
  };
  const env = { DB: db };

  await dbModule.initializeDatabase(env);
  await dbModule.initializeDatabase(env);

  assert.equal(schemaChecks, 1);
  assert.equal(writes, 2);
});

test("does not classify an arbitrary word containing ci as CI infrastructure", () => {
  assert.equal(
    githubModule.detectDomain("[CI] update the nightly pytest workflow"),
    "CI / Infra",
  );
  assert.equal(
    githubModule.detectDomain("Improve precision for a distinct circuit"),
    "Other",
  );
  assert.equal(
    githubModule.detectDomain(
      "[Bugfix] stop template markers leaking\nRun pytest and nightly validation for the parser.",
    ),
    "Other",
  );
});

test("uses changed files as the primary domain evidence", () => {
  const result = githubModule.classifyDomain({
    title: "[Docs] explain the new backend",
    body: "This also updates examples and usage notes.",
    files: [
      {
        path: "vllm/model_executor/layers/attention/mla_attention.py",
        additions: 120,
        deletions: 18,
      },
      {
        path: "tests/attention/test_mla.py",
        additions: 44,
        deletions: 3,
      },
      { path: "docs/features/attention.md", additions: 20, deletions: 0 },
    ],
  });
  assert.equal(result.domain, "Attention");
  assert.equal(result.source, "files");
  assert.equal(result.confidenceLabel, "high");
  assert.deepEqual(result.matchedPaths, [
    "vllm/model_executor/layers/attention/mla_attention.py",
    "tests/attention/test_mla.py",
  ]);
});

test("uses operational domains only when no technical path is stronger", () => {
  const result = githubModule.classifyDomain({
    title: "Refresh contributor guide",
    files: [
      { path: "docs/contributing.md", additions: 12, deletions: 4 },
      { path: "README.md", additions: 3, deletions: 1 },
    ],
  });
  assert.equal(result.domain, "Documentation");
  assert.equal(result.source, "files");
});

test("turns verifiable GitHub facts into a review action", () => {
  const failing = githubModule.buildReviewSignal(
    {
      state: "open",
      draft: false,
      mergeability: "mergeable",
      changedFiles: 8,
      additions: 240,
      deletions: 31,
      checks: [
        { name: "unit-test", status: "failure" },
        { name: "lint", status: "success" },
      ],
      source: "github-rest",
    },
    "Scheduler",
  );
  assert.equal(failing.action, "attention");
  assert.equal(failing.ciStatus, "failure");
  assert.match(failing.label, /CI 失败/);

  const conflict = githubModule.buildReviewSignal({
    state: "open",
    draft: false,
    mergeability: "conflicting",
    checks: [{ name: "unit-test", status: "success" }],
    source: "github-rest",
  });
  assert.equal(conflict.action, "blocked");
  assert.equal(conflict.label, "先解决冲突");

  const draft = githubModule.buildReviewSignal({
    state: "open",
    draft: true,
    mergeability: "mergeable",
    checks: [{ name: "unit-test", status: "success" }],
    source: "github-rest",
  });
  assert.equal(draft.action, "waiting");
  assert.equal(draft.label, "Draft，暂缓");

  const merged = githubModule.buildReviewSignal({
    state: "merged",
    draft: false,
    source: "metadata",
  });
  assert.equal(merged.action, "complete");
  assert.equal(merged.score, 0);
});

test("removes common pull request template headings from excerpt summaries", () => {
  assert.equal(
    githubModule.fallbackSummary(
      "[CI] main2main vLLM",
      "### What this PR does / why we need it?\r\n\r\nmain2main vLLM upgrade to v0.26.0\r\n\r\n### How was this patch tested?\r\n",
      "CI / Infra",
    ),
    "main2main vLLM upgrade to v0.26.0",
  );
  assert.equal(
    githubModule.fallbackSummary(
      "Refactor KV Pool",
      "### What this PR does / why we need it?\r\n\r\nThis PR simplifies the KV Pool implementation without changing its behavior and removes redundant wrappers.\r\n",
      "Scheduler",
    ),
    "This PR simplifies the KV Pool implementation without changing its behavior and removes redundant wrappers.",
  );
});

test("parses changed-file statistics from a unified diff", () => {
  const result = githubModule.parseUnifiedDiff(`diff --git a/a.py b/a.py
--- a/a.py
+++ b/a.py
@@ -1 +1,2 @@
-old
+new
+next
diff --git a/b.md b/b.md
--- a/b.md
+++ b/b.md
@@ -0,0 +1 @@
+hello
`);
  assert.equal(result.files, 2);
  assert.equal(result.additions, 3);
  assert.equal(result.deletions, 1);
  assert.deepEqual(
    result.entries.map(({ path, additions, deletions }) => ({
      path,
      additions,
      deletions,
    })),
    [
      { path: "a.py", additions: 2, deletions: 1 },
      { path: "b.md", additions: 1, deletions: 0 },
    ],
  );
});

test("deduplicates near-identical GitHub and sync transition observations", () => {
  const rows = [
    {
      event_id: "sync-close",
      item_id: "vllm:pr:1",
      event_type: "closed",
      occurred_at: "2026-07-30T03:55:43.000Z",
      source: "sync",
    },
    {
      event_id: "github-close",
      item_id: "vllm:pr:1",
      event_type: "closed",
      occurred_at: "2026-07-30T03:55:42.000Z",
      source: "github",
    },
    {
      event_id: "later-close",
      item_id: "vllm:pr:1",
      event_type: "closed",
      occurred_at: "2026-07-30T08:00:00.000Z",
      source: "github",
    },
  ];
  const result = intelligenceModule.deduplicateObservedEvents(rows);
  assert.deepEqual(
    result.map((event) => event.event_id),
    ["github-close", "later-close"],
  );
});

test("recognizes the public API surface without accepting lookalike paths", () => {
  const accepted = [
    "/api/health",
    "/api/community",
    "/api/community/vllm/pr/42",
    "/api/community/vllm-ascend/pr/42/diff-files",
    "/api/community/vllm/issue/7/analyze",
    "/api/settings/ai-providers/provider-1/activate",
    "/api/chat/threads/thread-1/messages",
  ];
  for (const path of accepted) {
    assert.equal(routeManifestModule.isKnownApiPath(path), true, path);
  }

  const rejected = [
    "/api/community/vllm/pr/not-a-number",
    "/api/community/vllm/pr/42/files",
    "/api/settings/secrets",
    "/api/chat/threads/thread-1/messages/extra",
    "/api/health/extra",
  ];
  for (const path of rejected) {
    assert.equal(routeManifestModule.isKnownApiPath(path), false, path);
  }
});
