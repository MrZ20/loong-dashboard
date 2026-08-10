import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4174;
const DEFAULT_SCHEDULE_INTERVAL_MS = 15 * 60_000;
const READY_RETRY_MS = 500;
const READY_TIMEOUT_MS = 30_000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function localServiceOptions(env = process.env) {
  const port = positiveInteger(env.LOONGBOARD_PORT, DEFAULT_PORT);
  const scheduleIntervalMs = positiveInteger(
    env.LOONGBOARD_SCHEDULE_INTERVAL_MS,
    DEFAULT_SCHEDULE_INTERVAL_MS,
  );
  return {
    port,
    scheduleIntervalMs,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

export async function waitForLocalService(
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = READY_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Wrangler is still compiling or binding the local port.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_RETRY_MS));
  }
  throw new Error(`LoongBoard 服务在 ${timeoutMs}ms 内未就绪`);
}

export async function triggerLocalScheduledRefresh(baseUrl, fetchImpl = fetch) {
  const response = await fetchImpl(`${baseUrl}/__scheduled`);
  if (!response.ok) {
    throw new Error(`本地自动刷新触发失败（HTTP ${response.status}）`);
  }
  return response;
}

export function startLocalService(env = process.env) {
  const { port, scheduleIntervalMs, baseUrl } = localServiceOptions(env);
  const wranglerBin = fileURLToPath(
    new URL("../node_modules/.bin/wrangler", import.meta.url),
  );
  const child = spawn(
    wranglerBin,
    [
      "dev",
      "--config",
      "wrangler.local.toml",
      "--port",
      String(port),
      "--test-scheduled",
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit", env },
  );

  let stopping = false;
  let refreshRunning = false;
  let interval = null;

  const runScheduledRefresh = async () => {
    if (refreshRunning || stopping) return;
    refreshRunning = true;
    try {
      await triggerLocalScheduledRefresh(baseUrl);
      console.log(`[Local Scheduler] 已扫描到期刷新任务；下次扫描约 ${Math.round(scheduleIntervalMs / 60_000)} 分钟后`);
    } catch (error) {
      console.error(`[Local Scheduler] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      refreshRunning = false;
    }
  };

  void waitForLocalService(baseUrl)
    .then(async () => {
      await runScheduledRefresh();
      if (!stopping) interval = setInterval(runScheduledRefresh, scheduleIntervalMs);
    })
    .catch((error) => {
      console.error(`[Local Scheduler] ${error instanceof Error ? error.message : String(error)}`);
    });

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    if (interval) clearInterval(interval);
    if (!child.killed) child.kill(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => stop(signal));
  }
  child.on("exit", (code, signal) => {
    stopping = true;
    if (interval) clearInterval(interval);
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  child.on("error", (error) => {
    stopping = true;
    if (interval) clearInterval(interval);
    console.error(`[Local Scheduler] 无法启动 Wrangler：${error.message}`);
    process.exitCode = 1;
  });
  return child;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startLocalService();
}
