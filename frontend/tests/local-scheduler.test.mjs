import assert from "node:assert/strict";
import test from "node:test";
import {
  localServiceOptions,
  triggerLocalScheduledRefresh,
  waitForLocalService,
} from "../scripts/dev-service.mjs";

test("local service enables Wrangler scheduled events and scans every 15 minutes", async () => {
  const options = localServiceOptions({});
  assert.equal(options.port, 4174);
  assert.equal(options.scheduleIntervalMs, 15 * 60_000);

  const requests = [];
  await triggerLocalScheduledRefresh(options.baseUrl, async (url) => {
    requests.push(url);
    return new Response("ok");
  });
  assert.deepEqual(requests, ["http://127.0.0.1:4174/__scheduled"]);
});

test("local scheduler waits for Worker health before the first due-task scan", async () => {
  let attempts = 0;
  await waitForLocalService("http://127.0.0.1:4174", async (url) => {
    assert.equal(url, "http://127.0.0.1:4174/api/health");
    attempts += 1;
    return new Response("ok", { status: attempts === 1 ? 503 : 200 });
  }, 2_000);
  assert.equal(attempts, 2);
});

test("local scheduled trigger surfaces HTTP failures", async () => {
  await assert.rejects(
    triggerLocalScheduledRefresh("http://127.0.0.1:4174", async () =>
      new Response("not ready", { status: 503 })),
    /HTTP 503/,
  );
});
