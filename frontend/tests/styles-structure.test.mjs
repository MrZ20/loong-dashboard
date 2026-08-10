import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("style entrypoint preserves domain and cascade order", () => {
  const entrypoint = readFileSync("src/styles.css", "utf8");
  const imports = [...entrypoint.matchAll(/@import "([^"]+)";/g)]
    .map((match) => match[1]);
  assert.deepEqual(imports, [
    "./styles/foundations.css",
    "./styles/shell.css",
    "./styles/community-list.css",
    "./styles/community-detail.css",
    "./styles/daily-report.css",
    "./styles/workspaces.css",
    "./styles/docs-chat.css",
    "./styles/settings.css",
    "./styles/settings-responsive.css",
  ]);
});

test("large style domains remain mechanically separated", () => {
  const list = readFileSync("src/styles/community-list.css", "utf8");
  const detail = readFileSync("src/styles/community-detail.css", "utf8");
  const daily = readFileSync("src/styles/daily-report.css", "utf8");
  const settings = readFileSync("src/styles/settings.css", "utf8");
  const responsive = readFileSync("src/styles/settings-responsive.css", "utf8");

  assert.match(list, /\.community-row \{/);
  assert.doesNotMatch(list, /\.detail-drawer \{/);
  assert.match(detail, /\.detail-drawer \{/);
  assert.doesNotMatch(detail, /\.daily-layout \{/);
  assert.match(daily, /\.daily-layout \{/);
  assert.match(settings, /\.settings-card \{/);
  assert.doesNotMatch(settings, /@media \(max-width: 1100px\)/);
  assert.match(responsive, /^@media \(max-width: 820px\)/);
  assert.match(responsive, /@media \(max-width: 1100px\)/);
});

test("AI task navigation keeps its task list independently scrollable", () => {
  const settings = readFileSync("src/styles/settings.css", "utf8");
  const responsive = readFileSync("src/styles/settings-responsive.css", "utf8");

  assert.match(settings, /\.ai-task-navigation \{[^}]*display: grid;[^}]*height: calc\(100dvh - 110px\);[^}]*grid-template-rows: auto minmax\(0, 1fr\);/s);
  assert.match(settings, /\.ai-task-group-list \{[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
  assert.match(responsive, /\.ai-task-navigation \{[^}]*height: auto;[^}]*max-height: none;/s);
  assert.match(responsive, /\.ai-task-group-list \{[^}]*overflow-y: visible;/s);
});
