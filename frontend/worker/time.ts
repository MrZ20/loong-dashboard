const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1_000;

export function beijingDate(now = new Date()) {
  return new Date(now.valueOf() + BEIJING_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export function beijingDayWindow(date = beijingDate()) {
  const start = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(start.valueOf())) {
    throw new Error("北京时间日期格式不正确");
  }
  const end = new Date(start.valueOf() + 24 * 60 * 60 * 1_000);
  return {
    date,
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: "Asia/Shanghai" as const,
  };
}

export function formatBeijingTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}
