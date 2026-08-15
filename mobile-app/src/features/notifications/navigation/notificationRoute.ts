import type { Notification } from "@/features/notifications/types/notification";

export type NotificationRoute =
  | {
      pathname: "/transaction/[transactionId]";
      params: { accountId: string; transactionId: string };
    }
  | "/profile";

export function getNotificationRoute(
  notification: Notification,
): NotificationRoute | null {
  if (
    notification.type === "TRANSFER" &&
    notification.resourceId &&
    notification.resourceAccountId
  ) {
    return {
      pathname: "/transaction/[transactionId]",
      params: {
        accountId: notification.resourceAccountId,
        transactionId: notification.resourceId,
      },
    };
  }

  if (notification.type === "SECURITY") {
    return "/profile";
  }

  return null;
}
