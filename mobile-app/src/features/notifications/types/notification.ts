export type NotificationType = "TRANSFER" | "SECURITY";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceId: string | null;
  resourceAccountId: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationsResponse = {
  items: Notification[];
};
