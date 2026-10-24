import { invalidRequest } from "../errors.js";
import type { Money } from "../types.js";

export type { Money };

/**
 * Parses and validates an untrusted input value as a VND monetary amount in minor units (đồng).
 */
export function parseMoney(value: unknown, fieldName: string): bigint {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).currency !== "VND" ||
    typeof (value as Record<string, unknown>).amountMinor !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test((value as Record<string, unknown>).amountMinor as string)
  ) {
    throw invalidRequest(`${fieldName} must be a non-negative VND minor-unit amount.`);
  }

  return BigInt((value as Record<string, unknown>).amountMinor as string);
}

/**
 * Converts a non-negative bigint amount in VND minor units to a Money domain object.
 */
export function toMoney(amountMinor: bigint): Money {
  if (amountMinor < 0n) {
    throw new RangeError("Money cannot be negative.");
  }

  return { currency: "VND", amountMinor: amountMinor.toString() };
}
