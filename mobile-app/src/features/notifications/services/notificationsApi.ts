import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type { Notification, NotificationsResponse } from "@/features/notifications/types/notification";
import { isNotification, isNotificationsResponse } from "@/features/notifications/validation/notificationValidators";

export function listNotifications(auth: RequestAuth): Promise<NotificationsResponse> {
  return requestJson<NotificationsResponse>(
    "/notifications",
    { auth },
    isNotificationsResponse,
  );
}

export function markNotificationRead(
  notificationId: string,
  auth: RequestAuth,
): Promise<Notification> {
  const normalizedId = notificationId.trim();
  if (!normalizedId) {
    return Promise.reject(new TypeError("notificationId must be non-empty."));
  }

  return requestJson<Notification>(
    `/notifications/${encodeURIComponent(normalizedId)}/read`,
    { method: "POST", auth },
    isNotification,
  );
}

export const notificationsApi = { listNotifications, markNotificationRead };
