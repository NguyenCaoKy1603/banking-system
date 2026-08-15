import { getNotificationRoute } from "@/features/notifications/navigation/notificationRoute";
import type { Notification } from "@/features/notifications/types/notification";

const baseNotification: Notification = {
  id: "notification-1",
  type: "TRANSFER",
  title: "Chuyển tiền",
  body: "Giao dịch đã cập nhật.",
  resourceId: "transaction-1",
  resourceAccountId: "account-1",
  read: false,
  createdAt: "2026-08-14T00:00:00Z",
};

describe("getNotificationRoute", () => {
  it("deep-links transfer notifications to transaction detail", () => {
    expect(getNotificationRoute(baseNotification)).toEqual({
      pathname: "/transaction/[transactionId]",
      params: { accountId: "account-1", transactionId: "transaction-1" },
    });
  });

  it("deep-links security notifications to profile", () => {
    expect(
      getNotificationRoute({
        ...baseNotification,
        type: "SECURITY",
        resourceId: null,
        resourceAccountId: null,
      }),
    ).toBe("/profile");
  });

  it("deep-links savings notifications to the deposit detail", () => {
    expect(
      getNotificationRoute({
        ...baseNotification,
        type: "SAVINGS",
        resourceId: "deposit-1",
        resourceAccountId: "account-1",
      }),
    ).toEqual({
      pathname: "/savings/[depositId]",
      params: { depositId: "deposit-1" },
    });
  });

  it("deep-links credit notifications to the card detail", () => {
    expect(
      getNotificationRoute({
        ...baseNotification,
        type: "CREDIT",
        resourceId: "card-1",
        resourceAccountId: null,
      }),
    ).toEqual({
      pathname: "/cards/[cardId]",
      params: { cardId: "card-1" },
    });
  });
});
