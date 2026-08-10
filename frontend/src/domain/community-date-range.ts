const beijingDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function beijingDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  const parts = Object.fromEntries(
    beijingDateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeDateRange(from: string, to: string) {
  if (!from || !to || from <= to) return { from, to };
  return { from: to, to: from };
}

export function recentBeijingDateRange(days: number, now = new Date()) {
  const to = beijingDateKey(now);
  if (!to) return { from: "", to: "" };
  const [year, month, day] = to.split("-").map(Number);
  const fromDate = new Date(Date.UTC(year, month - 1, day - Math.max(1, days) + 1));
  return { from: fromDate.toISOString().slice(0, 10), to };
}
