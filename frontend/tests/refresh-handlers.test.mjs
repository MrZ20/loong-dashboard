import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importWorkerModule } from "./helpers/import-worker-module.mjs";

const registry = await importWorkerModule("worker/services/refresh-handlers/registry.ts");

test("refresh task definitions keep independent policies and executors", () => {
  const definitions = registry.REFRESH_TASK_DEFINITIONS;
  assert.deepEqual(Object.keys(definitions), [
    "facts",
    "summary",
    "classification",
    "deep_analysis",
  ]);
  assert.deepEqual(definitions.facts.allowedRules, ["updated_since_success"]);
  assert.deepEqual(definitions.summary.allowedRules, [
    "code_only",
    "code_or_body",
    "any_update",
    "manual",
  ]);
  assert.deepEqual(definitions.classification.allowedRules, [
    "first_only",
    "code_only",
    "any_update",
    "manual",
  ]);
  assert.deepEqual(definitions.deep_analysis.allowedRules, ["manual"]);
  assert.equal(definitions.facts.handler.taskType, "facts");
  assert.equal(definitions.summary.handler.taskType, "summary");
  assert.equal(definitions.classification.handler.taskType, "classification");
  assert.equal(definitions.deep_analysis.handler, undefined);
});

test("refresh management delegates business execution to the handler registry", () => {
  const source = readFileSync("worker/services/refresh-management.ts", "utf8");
  assert.match(source, /getRefreshTaskHandler\(input\.taskType\)/);
  assert.doesNotMatch(source, /refreshCommunityFacts/);
  assert.doesNotMatch(source, /refreshCommunitySummaries/);
  assert.doesNotMatch(source, /refreshCommunityClassifications/);
});
