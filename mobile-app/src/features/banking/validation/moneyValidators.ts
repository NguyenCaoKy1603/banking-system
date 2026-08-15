import type { Money } from "@/features/banking/types/money";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMoney(value: unknown): value is Money {
  return (
    isRecord(value) &&
    value.currency === "VND" &&
    typeof value.amountMinor === "string" &&
    /^(?:0|[1-9]\d*)$/.test(value.amountMinor)
  );
}
