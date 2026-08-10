export function sanitizeRunnerError(value, config) {
  let message = String(value || "本地任务失败");
  for (const path of [config.worktreeRoot, ...Object.values(config.repositories || {})]) {
    if (path) message = message.split(String(path)).join("[local-path]");
  }
  return message
    .replace(/\/(?:Users|home|private|tmp)\/(?:[^\s:'\"]+\/?)+/g, "[local-path]")
    .slice(0, 2_000);
}
