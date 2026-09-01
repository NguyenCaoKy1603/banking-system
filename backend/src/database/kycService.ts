import { randomUUID } from "node:crypto";

import { conflict, invalidRequest, notFound } from "../errors.js";
import { fingerprint } from "../security.js";
import { UnitOfWork } from "./unitOfWork.js";
import { RelationalConflictError } from "./commandErrors.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CustomerKycStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "NEEDS_MORE_INFO"
  | "APPROVED"
  | "REJECTED";

export type CustomerKycInput = {
  fullName: unknown;
  identityNumber?: unknown;
  address: unknown;
  documentUri: unknown;
  syntheticDataConfirmed: unknown;
};

export type CustomerKycApplication = {
  id: string;
  userId: string;
  fullName: string;
  identityNumberLast4: string;
  address: string;
  documentUri: string;
  status: CustomerKycStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  updatedAt: string;
  version: number;
};

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must be a UUID.` });
}

function textField(value: unknown, field: string, min: number, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length < min || normalized.length > max) {
    throw invalidRequest(`${field} is invalid.`, { [field]: `${field} must contain between ${min} and ${max} characters.` });
  }
  return normalized;
}

type NormalizedKycInput = {
  fullName: string;
  identityNumber: string;
  address: string;
  documentUri: string;
  syntheticDataConfirmed: true;
};

function hasOwnProperty(value: object, property: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

export function normalizeInput(
  input: CustomerKycInput,
  existingIdentityNumber?: string,
): NormalizedKycInput {
  const fullName = textField(input.fullName, "fullName", 2, 120);
  const identityNumber = hasOwnProperty(input, "identityNumber")
    ? typeof input.identityNumber === "string" ? input.identityNumber : ""
    : existingIdentityNumber ?? "";
  if (!/^\d{6,24}$/.test(identityNumber)) {
    throw invalidRequest("identityNumber is invalid.", { identityNumber: "identityNumber must contain between 6 and 24 digits." });
  }
  const address = textField(input.address, "address", 5, 300);
  const documentUri = textField(input.documentUri, "documentUri", 1, 300);
  // The reference app accepts synthetic fixture URIs only.  This prevents a
  // browser client from accidentally turning this endpoint into a document
  // upload/PII store before a real KYC provider and retention policy exist.
  if (!/^(mock|synthetic):\/\//.test(documentUri)) {
    throw invalidRequest("documentUri must reference a synthetic fixture.", {
      documentUri: "Use a mock:// or synthetic:// fixture URI in this sandbox.",
    });
  }
  if (input.syntheticDataConfirmed !== true) {
    throw invalidRequest("syntheticDataConfirmed is required.", {
      syntheticDataConfirmed: "Confirm that the KYC fields contain synthetic sandbox data only.",
    });
  }
  return { fullName, identityNumber, address, documentUri, syntheticDataConfirmed: true };
}

function number(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function payload(row: Record<string, unknown>): Record<string, string> {
  const value = row.synthetic_payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { fullName: "", identityNumber: "", address: "", documentUri: "" };
  const record = value as Record<string, unknown>;
  return {
    fullName: typeof record.fullName === "string" ? record.fullName : "",
    identityNumber: typeof record.identityNumber === "string" ? record.identityNumber : "",
    address: typeof record.address === "string" ? record.address : "",
    documentUri: typeof record.documentUri === "string" ? record.documentUri : "",
  };
}

const KYC_STATUSES = new Set<CustomerKycStatus>([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_MORE_INFO",
  "APPROVED",
  "REJECTED",
]);

export function publicApplication(row: Record<string, unknown>): CustomerKycApplication {
  const data = payload(row);
  const status = String(row.status);
  const last4 = data.identityNumber.slice(-4);
  if (!/^\d{6,24}$/.test(data.identityNumber) || !/^\d{4}$/.test(last4) || !KYC_STATUSES.has(status as CustomerKycStatus)) {
    throw new RelationalConflictError("KYC_DATA_INVALID", "KYC application data is invalid.");
  }
  const submitted = row.submitted_at === null || row.submitted_at === undefined
    ? null
    : new Date(String(row.submitted_at)).toISOString();
  return {
    id: String(row.id),
    userId: String(row.customer_id),
    fullName: data.fullName,
    identityNumberLast4: last4,
    address: data.address,
    documentUri: data.documentUri,
    status: status as CustomerKycStatus,
    rejectionReason: row.decision_reason_code ? String(row.decision_reason_code) : null,
    submittedAt: submitted,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    version: number(row.version),
  };
}

const SELECT_COLUMNS = `id, customer_id, status, applicant_label, request_fingerprint,
  decision_reason_code, version, synthetic_payload, submitted_at, created_at, updated_at`;

/** Persistent customer KYC workflow for the reference relational-v2 runtime. */
export class RelationalKycService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async get(customerId: string): Promise<CustomerKycApplication | null> {
    assertUuid(customerId, "customerId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `SELECT ${SELECT_COLUMNS} FROM kyc_applications
          WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [customerId],
      );
      return result.rows[0] ? publicApplication(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async saveDraft(customerId: string, input: CustomerKycInput): Promise<CustomerKycApplication> {
    assertUuid(customerId, "customerId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const current = await this.lockOpen(client, customerId);
      if (current && ["SUBMITTED", "UNDER_REVIEW"].includes(String(current.status))) {
        throw conflict("KYC hồ sơ đã được gửi và đang chờ xử lý.");
      }
      const normalized = normalizeInput(input, current ? payload(current).identityNumber : undefined);
      const requestFingerprint = fingerprint(normalized);
      const row = current
        ? (await client.query(
          `UPDATE kyc_applications
              SET status = 'DRAFT', synthetic_payload = $2::jsonb,
                  request_fingerprint = $3, decision_reason_code = NULL,
                  submitted_at = NULL, version = version + 1, updated_at = NOW()
            WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
          [current.id, JSON.stringify(normalized), requestFingerprint],
        )).rows[0]
        : (await client.query(
          `INSERT INTO kyc_applications
             (id, customer_id, status, applicant_label, request_fingerprint, synthetic_payload, version, created_at, updated_at)
           VALUES ($1, $2, 'DRAFT', 'Synthetic KYC applicant', $3, $4::jsonb, 1, NOW(), NOW())
           RETURNING ${SELECT_COLUMNS}`,
          [randomUUID(), customerId, requestFingerprint, JSON.stringify(normalized)],
        )).rows[0];
      if (!row) throw new RelationalConflictError("KYC_WRITE_FAILED", "KYC draft could not be persisted.");
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "KYC_DRAFT_SAVED",
        actorCustomerId: customerId,
        resourceId: String(row.id),
        payload: { status: "DRAFT" },
      });
      return publicApplication(row as Record<string, unknown>);
    }, { maxRetries: 1 });
  }

  async submit(customerId: string, input: CustomerKycInput): Promise<CustomerKycApplication> {
    assertUuid(customerId, "customerId");
    return this.unitOfWork.transaction(async ({ client }) => {
      const current = await this.lockOpen(client, customerId);
      const normalized = normalizeInput(input, current ? payload(current).identityNumber : undefined);
      const requestFingerprint = fingerprint(normalized);
      if (current && ["SUBMITTED", "UNDER_REVIEW"].includes(String(current.status))) {
        // Retrying the same submit is safe and returns the already committed
        // application; a changed payload is rejected instead of silently
        // replacing data that a reviewer may already be looking at.
        if (String(current.request_fingerprint) !== requestFingerprint) {
          throw conflict("KYC hồ sơ đang được xử lý; không thể thay đổi dữ liệu.");
        }
        return publicApplication(current);
      }
      const submittedAt = new Date().toISOString();
      const row = current
        ? (await client.query(
          `UPDATE kyc_applications
              SET status = 'SUBMITTED', synthetic_payload = $2::jsonb,
                  request_fingerprint = $3, decision_reason_code = NULL,
                  submitted_at = $4::timestamptz, version = version + 1, updated_at = NOW()
            WHERE id = $1 RETURNING ${SELECT_COLUMNS}`,
          [current.id, JSON.stringify(normalized), requestFingerprint, submittedAt],
        )).rows[0]
        : (await client.query(
          `INSERT INTO kyc_applications
             (id, customer_id, status, applicant_label, request_fingerprint, synthetic_payload, submitted_at, version, created_at, updated_at)
           VALUES ($1, $2, 'SUBMITTED', 'Synthetic KYC applicant', $3, $4::jsonb, $5::timestamptz, 1, NOW(), NOW())
           RETURNING ${SELECT_COLUMNS}`,
          [randomUUID(), customerId, requestFingerprint, JSON.stringify(normalized), submittedAt],
        )).rows[0];
      if (!row) throw new RelationalConflictError("KYC_WRITE_FAILED", "KYC application could not be persisted.");
      const application = publicApplication(row as Record<string, unknown>);
      const notificationId = randomUUID();
      await client.query(
        `INSERT INTO notifications
          (id, customer_id, notification_type, title, body, resource_id,
           resource_account_id, is_read, created_at)
         VALUES ($1, $2, 'SECURITY', 'Đã tiếp nhận hồ sơ định danh',
                 'Hồ sơ định danh tổng hợp đã được gửi để nhân viên xem xét.', $3, NULL, false, $4)`,
        [notificationId, customerId, application.id, submittedAt],
      );
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "KYC_SUBMITTED",
        actorCustomerId: customerId,
        resourceId: application.id,
        occurredAt: submittedAt,
        payload: { status: "SUBMITTED" },
      });
      await new OutboxRepository(client).append({
        id: randomUUID(),
        eventType: "SECURITY_KYC_SUBMITTED",
        aggregateType: "kyc-application",
        aggregateId: application.id,
        aggregateVersion: application.version,
        deduplicationKey: `KYC_SUBMITTED:${application.id}:${application.version}`,
        occurredAt: submittedAt,
        subjectCustomerIds: [customerId],
        notificationIds: [notificationId],
        payload: { applicationId: application.id, status: "SUBMITTED" },
      });
      return application;
    }, { maxRetries: 1 });
  }

  private async lockOpen(client: import("pg").PoolClient, customerId: string): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM kyc_applications
        WHERE customer_id = $1
          AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO')
        ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [customerId],
    );
    return result.rows[0] ? result.rows[0] as Record<string, unknown> : null;
  }
}

export function mapKycDecisionStatus(value: unknown): Extract<CustomerKycStatus, "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO"> {
  const status = String(value ?? "");
  if (status === "APPROVED" || status === "REJECTED" || status === "NEEDS_MORE_INFO") return status;
  throw invalidRequest("decision must be APPROVED, REJECTED or NEEDS_MORE_INFO.");
}

export function kycNotFound(): never {
  throw notFound("KYC application not found.");
}
