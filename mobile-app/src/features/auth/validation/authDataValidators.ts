import type { AuthUser } from "@/features/auth/types/auth";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.fullName) &&
    isNonEmptyString(value.email) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) &&
    isNonEmptyString(value.phoneNumber) &&
    isNonEmptyDateTime(value.createdAt)
  );
}
