import type { Card, CardsResponse } from "@/features/cards/types/card";
import { isMoney } from "@/features/banking/validation/moneyValidators";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isCard(value: unknown): value is Card {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.displayName) &&
    (value.brand === "VISA" || value.brand === "MASTERCARD") &&
    isNonEmptyString(value.maskedNumber) &&
    /^\d{4}$/.test(String(value.lastFour)) &&
    Number.isInteger(value.expiryMonth) &&
    Number.isInteger(value.expiryYear) &&
    (value.status === "ACTIVE" || value.status === "LOCKED") &&
    typeof value.contactlessEnabled === "boolean" &&
    typeof value.pinConfigured === "boolean" &&
    isMoney(value.dailyLimit) &&
    isNonEmptyDateTime(value.updatedAt)
  );
}

export function isCardsResponse(value: unknown): value is CardsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isCard(item))
  );
}

export function validateMockPin(pin: string, confirmation: string): string | undefined {
  if (!/^\d{4,6}$/.test(pin)) {
    return "PIN mô phỏng phải có 4–6 chữ số.";
  }
  if (/^(\d)\1+$/.test(pin)) {
    return "PIN mô phỏng không được lặp cùng một chữ số.";
  }
  if (pin !== confirmation) {
    return "Xác nhận PIN không khớp.";
  }
  return undefined;
}
