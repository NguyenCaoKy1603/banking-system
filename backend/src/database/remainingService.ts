import { randomUUID } from "node:crypto";

import type { InternalRecipientLookup, Notification } from "../types.js";
import { conflict, invalidRequest, notFound } from "../errors.js";
import { createOpaqueToken, hashOpaqueToken } from "../security.js";
import { UnitOfWork } from "./unitOfWork.js";
import { AuditRepository } from "./repositories/auditRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
}

function accountNumber(value: unknown): string {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  if (!/^\d{6,34}$/.test(normalized)) throw invalidRequest("accountNumber is invalid.", { accountNumber: "accountNumber must contain 6 to 34 digits." });
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

export class RelationalRemainingService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async lookupRecipient(customerId: string, value: unknown): Promise<InternalRecipientLookup> {
    const targetNumber = accountNumber(value);
    return this.unitOfWork.transaction(async ({ client }) => {
      await client.query("DELETE FROM recipient_lookups WHERE expires_at <= NOW()");

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
      if (String(target.customer_id) === customerId) {
        const otherAccounts = await client.query(
          "SELECT id FROM payment_accounts WHERE customer_id = $1 AND id <> $2 AND status = 'ACTIVE' LIMIT 1",
          [customerId, target.id],
        );
        if (otherAccounts.rows.length === 0) {
          throw conflict("Không thể chuyển tiền cho chính tài khoản của mình.");
        }
      }
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

}
