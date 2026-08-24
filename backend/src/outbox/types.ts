export type OutboxStatus = "PENDING" | "PROCESSING" | "DISPATCHED" | "DEAD" | "SKIPPED";
export type DeliveryStatus = "PENDING" | "PROCESSING" | "SENT" | "DEAD" | "SKIPPED";
export type NotificationChannel = "PUSH" | "EMAIL";
export type NotificationCategory = "TRANSFER" | "SAVINGS" | "CREDIT" | "SECURITY";

export type EventEnvelope = {
  eventId: string;
  eventType: string;
  eventVersion: number;
  aggregate: {
    type: string;
    id: string;
    version: number;
  };
  occurredAt: string;
  traceId: string | null;
  subjectCustomerIds: string[];
  notificationIds: string[];
};

export type OutboxEventRow = {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  deduplicationKey: string;
  payload: unknown;
  status: OutboxStatus;
  priority: number;
  occurredAt: string;
  nextAttemptAt: string | null;
  attempts: number;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  publishedAt: string | null;
  deadLetteredAt: string | null;
  skippedAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  traceId: string | null;
  createdAt: string;
};

export type NotificationRow = {
  id: string;
  customerId: string;
  type: NotificationCategory;
  title: string;
  body: string;
  resourceId: string | null;
  read: boolean;
  createdAt: string;
};

export type EndpointRow = {
  id: string;
  customerId: string;
  deviceId: string;
  channel: NotificationChannel;
  provider: string;
  platform: string | null;
  addressCiphertext: string;
  addressFingerprint: string;
  status: "ACTIVE" | "INVALID" | "REVOKED";
};

export type DeliveryRow = {
  id: string;
  outboxEventId: string;
  notificationId: string;
  customerId: string;
  endpointId: string;
  channel: NotificationChannel;
  provider: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lockedBy: string | null;
  leaseExpiresAt: string | null;
  providerMessageId: string | null;
  lastErrorCode: string | null;
};

export type WorkerStatus = "STARTING" | "READY" | "DRAINING" | "STOPPED";
