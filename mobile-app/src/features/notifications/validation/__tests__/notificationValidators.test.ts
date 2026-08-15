import {
  isNotification,
  isNotificationsResponse,
} from "@/features/notifications/validation/notificationValidators";

const notification = {
  id: "notification-1",
  type: "TRANSFER" as const,
  title: "Transfer completed",
  body: "Your transfer was accepted.",
  resourceId: "transfer-1",
  resourceAccountId: "account-1",
  read: false,
  createdAt: "2026-08-14T00:00:00Z",
};

describe("notification validators", () => {
  it("validates notification responses", () => {
    expect(isNotification(notification)).toBe(true);
    expect(isNotificationsResponse({ items: [notification] })).toBe(true);
  });

  it("rejects malformed notification data", () => {
    expect(isNotification({ ...notification, read: "false" })).toBe(false);
    expect(isNotificationsResponse({ items: [{ ...notification, type: "UNKNOWN" }] })).toBe(false);
  });
});
