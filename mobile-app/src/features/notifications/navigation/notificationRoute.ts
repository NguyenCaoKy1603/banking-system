import type { Notification } from "@/features/notifications/types/notification";

export type NotificationRoute =
  | {
      pathname: "/transaction/[transactionId]";
      params: { accountId: string; transactionId: string };
    }
  | {
      pathname: "/savings/[depositId]";
      params: { depositId: string };
    }
  | {
      pathname: "/cards/[cardId]";
      params: { cardId: string };
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

  if (notification.type === "SAVINGS" && notification.resourceId) {
    return {
      pathname: "/savings/[depositId]",
      params: { depositId: notification.resourceId },
    };
  }

  if (notification.type === "CREDIT" && notification.resourceId) {
    return {
      pathname: "/cards/[cardId]",
      params: { cardId: notification.resourceId },
    };
  }

  if (notification.type === "SECURITY") {
    return "/profile";
  }

  return null;
}
