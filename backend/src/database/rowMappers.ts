export type DatabaseRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`Database ${field} must be a UUID.`);
  }
  return value;
}

export function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

export function asBigIntString(value: unknown, field = "amount"): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value)) return value;
  throw new Error(`Database ${field} must be an integer minor-unit value.`);
}

export function asIso(value: unknown, field = "timestamp"): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`Database ${field} must be a timestamp.`);
  return date.toISOString();
}

export function asNullableIso(value: unknown, field = "timestamp"): string | null {
  return value === null || value === undefined ? null : asIso(value, field);
}

export function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}
