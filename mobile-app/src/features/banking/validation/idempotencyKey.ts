import { safeRandomUUID } from "@/utils/uuid";

export const COMMAND_IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH = 8;

export function requireIdempotencyKey(
  value: string,
  minimumLength: number,
): string {
  if (!Number.isInteger(minimumLength) || minimumLength <= 0) {
    throw new TypeError("minimumLength phải là số nguyên dương.");
  }

  const normalized = value.trim();
  if (normalized.length < minimumLength) {
    throw new TypeError(
      `idempotencyKey phải có ít nhất ${minimumLength} ký tự.`,
    );
  }
  return normalized;
}

export function createIdempotencyKey(namespace: string): string {
  const normalizedNamespace = namespace.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalizedNamespace)) {
    throw new TypeError("Idempotency key namespace không hợp lệ.");
  }
  return `${normalizedNamespace}-${safeRandomUUID()}`;
}
