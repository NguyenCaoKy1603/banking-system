import { randomUUID } from "node:crypto";

import type { AnomalyStatus, TransactionAnomaly } from "../domain/anomaly/types.js";
import { conflict, invalidRequest, notFound } from "../errors.js";
import { UnitOfWork } from "./unitOfWork.js";
import { AnomalyRepository } from "./repositories/anomalyRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set<AnomalyStatus>([
  "OPEN",
  "CONFIRMED_SAFE",
  "REPORTED_SUSPICIOUS",
  "RESOLVED",
]);

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
  }
}

function normalizeStatusFilter(status?: string): AnomalyStatus | undefined {
  if (!status || !status.trim()) return undefined;
  const normalized = status.trim().toUpperCase();
  if (!VALID_STATUSES.has(normalized as AnomalyStatus)) {
    throw invalidRequest("status filter is invalid.", {
      status: "status must be OPEN, CONFIRMED_SAFE, REPORTED_SUSPICIOUS, or RESOLVED.",
    });
  }
  return normalized as AnomalyStatus;
}

export class RelationalAnomalyService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async listAnomalies(customerId: string, status?: string): Promise<TransactionAnomaly[]> {
    assertUuid(customerId, "customerId");
    const statusFilter = normalizeStatusFilter(status);
    return this.unitOfWork.transaction(async ({ client }) => {
      return new AnomalyRepository(client).listByCustomer(customerId, statusFilter);
    });
  }

  async getAnomaly(customerId: string, anomalyId: string): Promise<TransactionAnomaly> {
    assertUuid(customerId, "customerId");
    assertUuid(anomalyId, "anomalyId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const record = await new AnomalyRepository(client).findByIdForCustomer(customerId, anomalyId);
      if (!record) throw notFound("Transaction anomaly not found.");
      return record;
    });
  }

  async acknowledgeAnomaly(input: {
    customerId: string;
    anomalyId: string;
    decision: unknown;
    note?: unknown;
    traceId?: string;
  }): Promise<TransactionAnomaly> {
    assertUuid(input.customerId, "customerId");
    assertUuid(input.anomalyId, "anomalyId");

    if (input.decision !== "CONFIRMED_SAFE" && input.decision !== "REPORTED_SUSPICIOUS") {
      throw invalidRequest("decision is invalid.", {
        decision: "decision must be CONFIRMED_SAFE or REPORTED_SUSPICIOUS.",
      });
    }
    const decision: "CONFIRMED_SAFE" | "REPORTED_SUSPICIOUS" = input.decision;

    const rawNote = typeof input.note === "string" ? input.note.trim() : "";
    if (rawNote.length > 500) {
      throw invalidRequest("note is too long.", {
        note: "note must be at most 500 characters.",
      });
    }
    const customerNote = rawNote.length > 0 ? rawNote : null;
    const now = new Date().toISOString();

    return this.unitOfWork.transaction(async ({ client }) => {
      const repo = new AnomalyRepository(client);
      const current = await repo.findByIdForCustomer(input.customerId, input.anomalyId, true);
      if (!current) throw notFound("Transaction anomaly not found.");

      if (current.status === "RESOLVED") {
        throw conflict("Cảnh báo giao dịch này đã được quản trị viên đóng.");
      }
      if (current.status === decision) {
        return current;
      }

      const updated = await repo.updateCustomerAcknowledgement({
        anomalyId: current.id,
        status: decision,
        customerNote,
        now,
      });

      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "TRANSACTION_ANOMALY_ACKNOWLEDGED",
        actorCustomerId: input.customerId,
        resourceId: updated.id,
        occurredAt: now,
        traceId: input.traceId,
        payload: {
          decision,
          transferId: updated.transferId,
          riskLevel: updated.riskLevel,
          riskScore: updated.riskScore,
        },
      });

      if (decision === "REPORTED_SUSPICIOUS") {
        const notificationId = randomUUID();
        await client.query(
          `INSERT INTO notifications
             (id, customer_id, notification_type, title, body, resource_id,
              resource_account_id, is_read, created_at)
           VALUES ($1, $2, 'SECURITY', 'Đã tiếp nhận báo cáo giao dịch bất thường',
                   'Báo cáo nghi ngờ giao dịch của bạn đã được chuyển tới bộ phận vận hành để rà soát.',
                   $3, NULL, false, $4)`,
          [notificationId, input.customerId, updated.id, now],
        );

        await new OutboxRepository(client).append({
          id: randomUUID(),
          eventType: "SECURITY_ANOMALY_ACKNOWLEDGED",
          aggregateType: "security",
          aggregateId: updated.id,
          deduplicationKey: `SECURITY_ANOMALY_ACKNOWLEDGED:${updated.id}:${decision}`,
          occurredAt: now,
          traceId: input.traceId,
          subjectCustomerIds: [input.customerId],
          notificationIds: [notificationId],
          payload: {
            anomalyId: updated.id,
            decision,
          },
        });
      }

      return updated;
    }, { traceId: input.traceId, maxRetries: 1 });
  }
}
