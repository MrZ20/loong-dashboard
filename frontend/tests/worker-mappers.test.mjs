import assert from "node:assert/strict";
import test from "node:test";
import { importWorkerModule } from "./helpers/import-worker-module.mjs";

const mapperModule = await importWorkerModule("worker/mappers/index.ts");
const dbModule = await importWorkerModule("worker/db.ts");

test("database row JSON helpers safely reject empty, invalid, and wrong-shape values", () => {
  assert.deepEqual(mapperModule.parseJson("", ["fallback"]), ["fallback"]);
  assert.deepEqual(mapperModule.parseJson("{broken", { safe: true }), { safe: true });
  assert.deepEqual(mapperModule.parseJson(null, { safe: true }), { safe: true });
});

test("community row mapper normalizes D1 scalars and malformed JSON without throwing", () => {
  const item = mapperModule.mapCommunityItem({
    id: "vllm:pr:12",
    repo_id: "vllm",
    kind: "pr",
    number: "12",
    state: "open",
    title: "Typed mapping",
    important: 0,
    is_draft: "1",
    labels_json: "{}",
    domain: "Attention",
    domain_confidence: "not-a-number",
    domain_evidence_json: "[]",
    review_signal_json: "{broken",
    summary_source: "ai",
    summary_structured_json: "[]",
    summary_evidence_json: "[\"path.py\",3]",
    classification_details_json: "null",
    fetched_at: "2026-08-09T00:00:00.000Z",
  });

  assert.equal(item.number, 12);
  assert.equal(item.important, false);
  assert.equal(item.isDraft, true);
  assert.deepEqual(item.labels, []);
  assert.equal(item.summaryStatus, "ready");
  assert.deepEqual(item.summaryVersion.structured, {});
  assert.deepEqual(item.summaryVersion.evidence, ["path.py"]);
  assert.deepEqual(item.classificationVersion.details, {});
  assert.equal(item.domainAssessment.domain, "Attention");
  assert.equal(item.domainAssessment.confidence, 0);
  assert.equal(item.reviewSignal, null);
  assert.equal(item.factsRefreshedAt, "2026-08-09T00:00:00.000Z");
});

test("community diff stats omit patch bodies while full mode preserves stored data", () => {
  const row = {
    kind: "pr",
    diff_json: JSON.stringify({
      files: 2,
      additions: 7,
      deletions: 2,
      raw: "large raw diff",
      entries: [
        { path: "worker/a.ts", additions: "7", deletions: 2, patch: "@@ patch" },
        "invalid-entry",
      ],
    }),
  };
  const stats = mapperModule.mapCommunityItem(row, "stats").diff;
  const full = mapperModule.mapCommunityItem(row, "full").diff;

  assert.equal(stats.raw, undefined);
  assert.deepEqual(stats.entries, [{ path: "worker/a.ts", additions: 7, deletions: 2 }]);
  assert.equal(stats.statsOnly, true);
  assert.equal(stats.complete, false);
  assert.equal(full.raw, "large raw diff");
  assert.equal(full.entries[0].patch, "@@ patch");
});

test("analysis mapper keeps only safe collection shapes and applies version defaults", () => {
  const analysis = mapperModule.mapAnalysis({
    id: "analysis-1",
    prompt_revision: "invalid",
    source_refs_json: "[\"PR #1\",7]",
    code_references_json: "[{\"repository\":\"vllm\"},\"bad\",null]",
    local_evidence: "0",
  });

  assert.equal(analysis.id, "analysis-1");
  assert.equal(analysis.promptRevision, 1);
  assert.equal(analysis.runner, "api");
  assert.equal(analysis.analysisSource, "unknown");
  assert.deepEqual(analysis.sourceRefs, ["PR #1"]);
  assert.deepEqual(analysis.codeReferences, [{ repository: "vllm" }]);
  assert.equal(analysis.localEvidence, false);
});

test("technical document mapper filters invalid tag and reference entries", () => {
  const document = mapperModule.mapTechnicalDocument({
    id: "doc-1",
    title: "Architecture",
    tags_json: "[\"scheduler\",2,null]",
    source_refs_json: "{\"bad\":true}",
  });
  assert.deepEqual(document.tags, ["scheduler"]);
  assert.deepEqual(document.sourceRefs, []);
  assert.equal(document.contentMd, "");
});

test("database infrastructure no longer re-exports domain mappers", () => {
  assert.equal(dbModule.mapCommunityItem, undefined);
  assert.equal(dbModule.mapAnalysis, undefined);
  assert.equal(dbModule.mapTechnicalDocument, undefined);
  assert.equal(dbModule.parseJson, undefined);
  assert.equal(typeof mapperModule.mapCommunityItem, "function");
});
