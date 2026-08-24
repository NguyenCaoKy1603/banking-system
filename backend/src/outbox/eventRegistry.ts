import type { EventEnvelope, NotificationCategory, NotificationChannel } from "./types.js";

export type EventPolicy = {
  eventType: string;
  version: number;
  category: NotificationCategory;
  channels: readonly NotificationChannel[];
  priority: number;
  maximumAttempts: number;
  freshnessSeconds: number | null;
  legacyAliases?: readonly string[];
};

const policy = (
  eventType: string,
  category: NotificationCategory,
  channels: readonly NotificationChannel[],
  priority: number,
  freshnessSeconds: number | null,
  legacyAliases: readonly string[] = [],
): EventPolicy => ({
  eventType,
  version: 1,
  category,
  channels,
  priority,
  maximumAttempts: 8,
  freshnessSeconds,
  legacyAliases,
});

export const EVENT_POLICIES: readonly EventPolicy[] = [
  // Registration is already visible through the committed account state; the
  // event is retained for audit/integration consumers but does not fan out to
  // push or email by default.
  policy("customer.registered", "SECURITY", [], 50, null, ["CUSTOMER_REGISTERED"]),
  policy("transfer.pending", "TRANSFER", ["PUSH"], 20, 24 * 60 * 60, ["TRANSFER_PENDING"]),
  policy("transfer.succeeded", "TRANSFER", ["PUSH", "EMAIL"], 10, 7 * 24 * 60 * 60, ["TRANSFER_SUCCEEDED"]),
  policy("transfer.failed", "TRANSFER", ["PUSH", "EMAIL"], 10, 7 * 24 * 60 * 60, ["TRANSFER_FAILED"]),
  policy("transfer.reversed", "TRANSFER", ["PUSH", "EMAIL"], 10, 7 * 24 * 60 * 60, ["TRANSFER_REVERSED"]),
  policy("savings.opening_pending", "SAVINGS", ["PUSH"], 40, 24 * 60 * 60, ["SAVINGS_OPENING_PENDING"]),
  policy("savings.opening_succeeded", "SAVINGS", ["PUSH", "EMAIL"], 30, 7 * 24 * 60 * 60, ["SAVINGS_OPENING_SUCCEEDED"]),
  policy("savings.opening_failed", "SAVINGS", ["PUSH", "EMAIL"], 30, 7 * 24 * 60 * 60, ["SAVINGS_OPENING_FAILED"]),
  policy("savings.matured", "SAVINGS", ["PUSH", "EMAIL"], 30, 14 * 24 * 60 * 60, ["SAVINGS_MATURED"]),
  policy("savings.renewed", "SAVINGS", ["PUSH", "EMAIL"], 30, 14 * 24 * 60 * 60, ["SAVINGS_RENEWED"]),
  policy("credit.application_approved", "CREDIT", ["PUSH", "EMAIL"], 30, 7 * 24 * 60 * 60, ["CREDIT_APPLICATION_APPROVED"]),
  policy("credit.application_activated", "CREDIT", ["PUSH", "EMAIL"], 30, 7 * 24 * 60 * 60, ["CREDIT_APPLICATION_ACTIVATED"]),
  policy("credit.payment_pending", "CREDIT", ["PUSH"], 20, 24 * 60 * 60, ["CREDIT_PAYMENT_PENDING"]),
  policy("credit.payment_succeeded", "CREDIT", ["PUSH", "EMAIL"], 20, 7 * 24 * 60 * 60, ["CREDIT_PAYMENT_SUCCEEDED"]),
  policy("credit.payment_failed", "CREDIT", ["PUSH", "EMAIL"], 20, 7 * 24 * 60 * 60, ["CREDIT_PAYMENT_FAILED"]),
  policy("credit.statement_issued", "CREDIT", ["PUSH", "EMAIL"], 35, 14 * 24 * 60 * 60, ["CREDIT_STATEMENT_ISSUED"]),
  policy("credit.statement_overdue", "CREDIT", ["PUSH", "EMAIL"], 10, 30 * 24 * 60 * 60, ["CREDIT_STATEMENT_OVERDUE"]),
  policy("credit.card_locked", "CREDIT", ["PUSH", "EMAIL"], 5, null, ["CREDIT_CARD_LOCKED"]),
  policy("credit.card_unlocked", "CREDIT", ["PUSH", "EMAIL"], 5, null, ["CREDIT_CARD_UNLOCKED"]),
  policy("fraud.report_created", "SECURITY", ["PUSH", "EMAIL"], 5, null, ["FRAUD_REPORT_CREATED"]),
  policy("security.device_revoked", "SECURITY", ["PUSH", "EMAIL"], 5, null, ["SECURITY_DEVICE_REVOKED"]),
  policy("security.sessions_revoked", "SECURITY", ["PUSH", "EMAIL"], 5, null, ["SECURITY_SESSIONS_REVOKED"]),
  policy("sandbox.funding_succeeded", "SECURITY", [], 90, 24 * 60 * 60, ["SANDBOX_FUNDING_SUCCEEDED"]),
];

const byName = new Map<string, EventPolicy>();
const aliases = new Map<string, EventPolicy>();
for (const item of EVENT_POLICIES) {
  byName.set(`${item.eventType}.v${item.version}`, item);
  for (const alias of item.legacyAliases ?? []) aliases.set(alias, item);
}

export function canonicalEventName(policyValue: EventPolicy): string {
  return `${policyValue.eventType}.v${policyValue.version}`;
}

export function resolveEventPolicy(eventType: string, version = 1): EventPolicy | null {
  return byName.get(`${eventType.replace(/\.v\d+$/, "")}.v${version}`) ?? aliases.get(eventType) ?? null;
}

export function buildEnvelope(input: {
  eventId: string;
  eventType: string;
  eventVersion?: number;
  aggregateType?: string;
  aggregateId: string;
  aggregateVersion?: number;
  occurredAt: string;
  traceId?: string | null;
  subjectCustomerIds?: readonly string[];
  notificationIds?: readonly string[];
}): EventEnvelope {
  const resolved = resolveEventPolicy(input.eventType, input.eventVersion ?? 1);
  const normalizedType = resolved ? canonicalEventName(resolved) : input.eventType;
  return {
    eventId: input.eventId,
    eventType: normalizedType,
    eventVersion: input.eventVersion ?? resolved?.version ?? 1,
    aggregate: {
      type: input.aggregateType ?? resolved?.category.toLowerCase() ?? "unknown",
      id: input.aggregateId,
      version: input.aggregateVersion ?? 1,
    },
    occurredAt: input.occurredAt,
    traceId: input.traceId ?? null,
    subjectCustomerIds: [...(input.subjectCustomerIds ?? [])],
    notificationIds: [...(input.notificationIds ?? [])],
  };
}

const forbiddenPayloadKey = /(password|otp|token|secret|pin|cvv|pan|push.?token|account.?number|fraud.?reason|database.?url|raw.?request|request.?body|authorization|cookie)/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertSafePayload(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafePayload(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenPayloadKey.test(key)) {
      throw new Error(`UNSAFE_EVENT_PAYLOAD:${path}.${key}`);
    }
    assertSafePayload(nested, `${path}.${key}`);
  }
}

/**
 * Produce a sanitized, log/DLQ-safe JSON snapshot.  Database rows can be
 * malformed or inserted by an older writer, so the worker must sanitize a
 * rejected event before persisting its dead-letter evidence as well.
 */
export function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
  if (!value || typeof value !== "object") return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    sanitized[key] = forbiddenPayloadKey.test(key) ? "[redacted]" : sanitizePayload(nested);
  }
  return sanitized;
}

export function validateEnvelope(value: unknown): EventEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EVENT_PAYLOAD_INVALID");
  }
  const candidate = value as Partial<EventEnvelope>;
  if (
    typeof candidate.eventId !== "string" ||
    !uuidPattern.test(candidate.eventId) ||
    typeof candidate.eventType !== "string" ||
    typeof candidate.eventVersion !== "number" ||
    !Number.isInteger(candidate.eventVersion) ||
    candidate.eventVersion <= 0 ||
    !candidate.aggregate ||
    typeof candidate.aggregate.id !== "string" ||
    !uuidPattern.test(candidate.aggregate.id) ||
    typeof candidate.aggregate.type !== "string" ||
    !Number.isInteger(candidate.aggregate.version) ||
    candidate.aggregate.version <= 0 ||
    typeof candidate.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.occurredAt)) ||
    !Array.isArray(candidate.subjectCustomerIds) ||
    !candidate.subjectCustomerIds.every((id) => typeof id === "string" && uuidPattern.test(id)) ||
    !Array.isArray(candidate.notificationIds) ||
    !candidate.notificationIds.every((id) => typeof id === "string" && uuidPattern.test(id)) ||
    (candidate.traceId !== null && candidate.traceId !== undefined && typeof candidate.traceId !== "string")
  ) {
    throw new Error("EVENT_PAYLOAD_INVALID");
  }
  assertSafePayload(candidate);
  const resolved = resolveEventPolicy(candidate.eventType, candidate.eventVersion);
  if (!resolved) throw new Error("EVENT_VERSION_UNSUPPORTED");
  return candidate as EventEnvelope;
}

export function isLegacyEmptyPayload(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}
