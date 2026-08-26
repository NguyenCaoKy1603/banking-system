import { randomUUID } from "node:crypto";

import type { InternalRecipientLookup, Notification, FraudReportResponse } from "../types.js";
import { conflict, invalidRequest, notFound } from "../errors.js";
import { createOpaqueToken, fingerprint, hashOpaqueToken } from "../security.js";
import { UnitOfWork } from "./unitOfWork.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";
import { RelationalConflictError, IdempotencyConflictError } from "./commandErrors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
}

function accountNumber(value: unknown): string {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  if (!/^\d{6,34}$/.test(normalized)) throw invalidRequest("accountNumber is invalid.", { accountNumber: "accountNumber must contain 6 to 34 digits." });
  return normalized;
}

function idempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 128) throw invalidRequest("Idempotency-Key must contain between 8 and 128 characters.");
  return normalized;
}

function notificationPublic(row: Record<string, unknown>): Notification {
  return {
    id: String(row.id),
    type: String(row.notification_type) as Notification["type"],
    title: String(row.title),
    body: String(row.body),
    resourceId: row.resource_id === null || row.resource_id === undefined ? null : String(row.resource_id),
    resourceAccountId: row.resource_account_id === null || row.resource_account_id === undefined ? null : String(row.resource_account_id),
    read: Boolean(row.is_read),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function fraudPublic(row: Record<string, unknown>): FraudReportResponse {
  return {
    reportId: String(row.id),
    status: String(row.status) as FraudReportResponse["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export class RelationalRemainingService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async lookupRecipient(customerId: string, value: unknown): Promise<InternalRecipientLookup> {
    const targetNumber = accountNumber(value);
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `SELECT a.id, a.customer_id, a.masked_number, a.bank_name, a.status,
                c.full_name
         FROM payment_accounts a
         JOIN customers c ON c.id = a.customer_id
         WHERE a.account_number = $1`,
        [targetNumber],
      );
      const target = result.rows[0] as Record<string, unknown> | undefined;
      if (!target) throw notFound("Recipient account not found.");
      if (String(target.customer_id) === customerId) throw conflict("Không thể chuyển tiền cho chính tài khoản của mình.");
      if (String(target.status) !== "ACTIVE") throw conflict("Tài khoản người nhận không hoạt động.");
      const lookupId = createOpaqueToken();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await client.query(
        `INSERT INTO recipient_lookups
          (token_hash, customer_id, destination_account_id, destination_owner_id,
           account_holder_name, masked_account_number, bank_name, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [hashOpaqueToken(lookupId), customerId, target.id, target.customer_id, target.full_name, target.masked_number, target.bank_name ?? "Ngân hàng reference", target.status, expiresAt],
      );
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "INTERNAL_RECIPIENT_LOOKED_UP", actorCustomerId: customerId, resourceId: String(target.id), occurredAt: new Date().toISOString() });
      return {
        lookupId,
        accountHolderName: String(target.full_name),
        maskedAccountNumber: String(target.masked_number),
        bankName: String(target.bank_name ?? "Ngân hàng reference"),
        status: String(target.status) as InternalRecipientLookup["status"],
        expiresAt,
      };
    });
  }

  async listNotifications(customerId: string): Promise<Notification[]> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query("SELECT * FROM notifications WHERE customer_id = $1 ORDER BY created_at DESC, id DESC", [customerId]);
      return result.rows.map((row) => notificationPublic(row as Record<string, unknown>));
    });
  }

  async markNotificationRead(customerId: string, notificationId: string): Promise<Notification> {
    assertUuid(notificationId, "notificationId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query("UPDATE notifications SET is_read = true WHERE id = $1 AND customer_id = $2 RETURNING *", [notificationId, customerId]);
      if (!result.rows[0]) throw notFound("Notification not found.");
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "NOTIFICATION_MARKED_READ", actorCustomerId: customerId, resourceId: notificationId });
      return notificationPublic(result.rows[0] as Record<string, unknown>);
    });
  }

  async reportFraud(input: { customerId: string; accountId: string; transactionId: string; reason: string; idempotencyKey: string; traceId?: string }): Promise<FraudReportResponse> {
    assertUuid(input.accountId, "accountId");
    assertUuid(input.transactionId, "transactionId");
    const reason = input.reason.trim();
    if (reason.length < 5) throw invalidRequest("reason must contain at least 5 characters.", { reason: "reason must contain at least 5 characters." });
    if (reason.length > 1000) throw invalidRequest("reason must not exceed 1000 characters.", { reason: "reason must not exceed 1000 characters." });
    const key = idempotencyKey(input.idempotencyKey);
    const requestFingerprint = fingerprint({ accountId: input.accountId, transactionId: input.transactionId, reason });
    return this.unitOfWork.transaction(async ({ client }) => {
      const existing = await client.query("SELECT * FROM fraud_report_idempotency WHERE customer_id = $1 AND idempotency_key = $2 FOR UPDATE", [input.customerId, key]);
      if (existing.rows[0]) {
        const row = existing.rows[0] as Record<string, unknown>;
        if (String(row.request_fingerprint) !== requestFingerprint) throw new IdempotencyConflictError();
        if (!row.report_id) throw new RelationalConflictError("IDEMPOTENCY_IN_PROGRESS", "Fraud report is still being finalized; retry with the same key.");
        const report = await client.query("SELECT * FROM fraud_reports WHERE id = $1 AND customer_id = $2", [row.report_id, input.customerId]);
        if (!report.rows[0]) throw new RelationalConflictError("IDEMPOTENCY_STATE_MISSING", "Fraud report idempotency state is missing its report.");
        return fraudPublic(report.rows[0] as Record<string, unknown>);
      }
      const transaction = await client.query(
        `SELECT t.id, t.account_id
         FROM account_transactions t
         JOIN payment_accounts a ON a.id = t.account_id
         WHERE t.id = $1 AND t.account_id = $2 AND a.customer_id = $3
         FOR UPDATE`,
        [input.transactionId, input.accountId, input.customerId],
      );
      if (!transaction.rows[0]) throw notFound("Transaction not found.");
      const open = await client.query("SELECT * FROM fraud_reports WHERE customer_id = $1 AND transaction_id = $2 AND status = 'RECEIVED' FOR UPDATE", [input.customerId, input.transactionId]);
      if (open.rows[0]) {
        const row = open.rows[0] as Record<string, unknown>;
        if (String(row.account_id) !== input.accountId || String(row.reason) !== reason) throw new RelationalConflictError("FRAUD_REPORT_ALREADY_EXISTS", "Giao dịch này đã có một báo cáo gian lận đang mở.");
        await client.query("INSERT INTO fraud_report_idempotency (id, customer_id, idempotency_key, request_fingerprint, report_id, status) VALUES ($1, $2, $3, $4, $5, 'RECEIVED')", [randomUUID(), input.customerId, key, requestFingerprint, row.id]);
        return fraudPublic(row);
      }
      const reportId = randomUUID();
      const report = await client.query(
        "INSERT INTO fraud_reports (id, customer_id, account_id, transaction_id, reason, status, created_at) VALUES ($1, $2, $3, $4, $5, 'RECEIVED', NOW()) RETURNING *",
        [reportId, input.customerId, input.accountId, input.transactionId, reason],
      );
      await client.query("INSERT INTO fraud_report_idempotency (id, customer_id, idempotency_key, request_fingerprint, report_id, status) VALUES ($1, $2, $3, $4, $5, 'RECEIVED')", [randomUUID(), input.customerId, key, requestFingerprint, reportId]);
      const now = new Date().toISOString();
      await new AuditRepository(client).append({ id: randomUUID(), eventType: "FRAUD_REPORT_CREATED", actorCustomerId: input.customerId, resourceId: input.transactionId, occurredAt: now, payload: { traceId: input.traceId ?? null } });
      await new OutboxRepository(client).append({ id: randomUUID(), eventType: "fraud.report_created", aggregateId: reportId, occurredAt: now, subjectCustomerIds: [input.customerId], traceId: input.traceId, payload: { reportId, transactionId: input.transactionId } });
      return fraudPublic(report.rows[0] as Record<string, unknown>);
    }, { traceId: input.traceId, maxRetries: 1 });
  }

  async getFraudReport(customerId: string, reportId: string): Promise<FraudReportResponse> {
    assertUuid(reportId, "reportId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query("SELECT * FROM fraud_reports WHERE id = $1 AND customer_id = $2", [reportId, customerId]);
      if (!result.rows[0]) throw notFound("Fraud report not found.");
      return fraudPublic(result.rows[0] as Record<string, unknown>);
    });
  }
}
