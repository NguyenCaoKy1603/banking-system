import type {
  Notification,
  NotificationsResponse,
} from "@/features/notifications/types/notification";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNotification(value: unknown): value is Notification {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.type === "TRANSFER" || value.type === "SAVINGS" || value.type === "CREDIT" || value.type === "SECURITY") &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.body) &&
    (typeof value.resourceId === "string" || value.resourceId === null) &&
    (typeof value.resourceAccountId === "string" || value.resourceAccountId === null) &&
    typeof value.read === "boolean" &&
    isNonEmptyDateTime(value.createdAt)
  );
}

export function isNotificationsResponse(
  value: unknown,
): value is NotificationsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isNotification(item))
  );
}
