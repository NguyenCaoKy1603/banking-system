import type { EventPolicy } from "../outbox/eventRegistry.js";
import type { NotificationRow } from "../outbox/types.js";

export function routeKeyForCategory(category: NotificationRow["type"]): string {
  if (category === "TRANSFER") return "TRANSACTION_DETAIL";
  if (category === "SAVINGS") return "SAVINGS_DETAIL";
  if (category === "CREDIT") return "CREDIT_DETAIL";
  return "SECURITY_ALERT";
}

export function pushPayload(notification: NotificationRow): Record<string, unknown> {
  return {
    notificationId: notification.id,
    category: notification.type,
    routeKey: routeKeyForCategory(notification.type),
  };
}

export function emailTemplate(policy: EventPolicy, notification: NotificationRow): {
  templateKey: string;
  variables: Record<string, string>;
} {
  return {
    templateKey: `notification.${policy.category.toLowerCase()}`,
    variables: {
      title: notification.title.slice(0, 160),
      body: notification.body.slice(0, 2000),
    },
  };
}
