import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importWorkerModule } from "./helpers/import-worker-module.mjs";

const discovery = await importWorkerModule("worker/integrations/github/pulls/discovery.ts");
const snapshots = await importWorkerModule("worker/integrations/github/pulls/snapshots.ts");
const files = await importWorkerModule("worker/integrations/github/pulls/files.ts");
const reviews = await importWorkerModule("worker/integrations/github/pulls/reviews.ts");
const normalizers = await importWorkerModule(
  "worker/integrations/github/pulls/normalizers.ts",
);

test("GitHub pull modules expose responsibility-specific APIs", () => {
  for (const name of [
    "fetchRecentIssues",
    "fetchIncrementalPulls",
    "fetchIncrementalIssues",
    "fetchIncrementalCommunity",
  ]) {
    assert.equal(typeof discovery[name], "function", `${name} must remain exported`);
  }
  assert.equal(typeof snapshots.fetchPullSyncSnapshots, "function");
  assert.equal(typeof files.fetchPullFileStats, "function");
  assert.equal(typeof files.fetchPullPatches, "function");
  assert.equal(typeof reviews.fetchPullBehindBy, "function");
  assert.equal(typeof reviews.fetchPullReviewFacts, "function");
  assert.equal(readFileSync("worker/integrations/github/pulls/discovery.ts", "utf8").includes("snapshots"), false);
});

test("shared pull normalizers preserve CI and review semantics", () => {
  assert.equal(normalizers.normalizeCheckStatus("COMPLETED", "FAILURE"), "failure");
  assert.equal(normalizers.normalizeCheckStatus("SUCCESS"), "success");
  assert.equal(normalizers.normalizeReviewDecision("APPROVED"), "approved");
  assert.equal(normalizers.normalizeMergeability("CONFLICTING"), "conflicting");
  assert.deepEqual(
    normalizers.mergeChecks([
      { name: "CI", status: "pending" },
      { name: "ci", status: "success" },
    ]),
    [{ name: "ci", status: "success" }],
  );
});
