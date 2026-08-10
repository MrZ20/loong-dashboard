export type DatabaseRow = Readonly<Record<string, unknown>>;
export type JsonObject = Record<string, unknown>;

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function rowText(row: DatabaseRow, field: string, fallback = "") {
  const value = row[field];
  return typeof value === "string" ? value : fallback;
}

export function rowNullableText(row: DatabaseRow, field: string) {
  const value = row[field];
  return typeof value === "string" && value !== "" ? value : null;
}

export function rowNumber(row: DatabaseRow, field: string, fallback = 0) {
  const value = Number(row[field] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function rowBoolean(row: DatabaseRow, field: string) {
  const value = row[field];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return value !== "" && value !== "0" && value.toLowerCase() !== "false";
  }
  return false;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rowJsonObject(
  row: DatabaseRow,
  field: string,
  fallback: JsonObject = {},
) {
  const value = parseJson<unknown>(row[field], fallback);
  return isJsonObject(value) ? value : fallback;
}

export function rowJsonArray<T = unknown>(
  row: DatabaseRow,
  field: string,
  fallback: T[] = [],
) {
  const value = parseJson<unknown>(row[field], fallback);
  return Array.isArray(value) ? value as T[] : fallback;
}

export function rowJsonStringArray(row: DatabaseRow, field: string) {
  return rowJsonArray<unknown>(row, field).filter(
    (value): value is string => typeof value === "string",
  );
}
