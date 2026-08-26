import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { DatabasePool } from "../../database/pool.js";
import { UnitOfWork } from "../../database/unitOfWork.js";
import { createId, createOpaqueToken, hashOpaqueToken } from "../../security.js";
import { conflictWithCode, invalidRequest, notFound } from "../../errors.js";
import { maskAccountNumber, maskEmail, maskPhone, redactAdminMetadata } from "../audit/redaction.js";
import type { AdminPermission, AdminRole } from "../authorization/permissionRegistry.js";
import { assertSafePayload, buildEnvelope, canonicalEventName, resolveEventPolicy, validateEnvelope } from "../../outbox/eventRegistry.js";

export type StaffStatus = "INVITED" | "ACTIVE" | "LOCKED" | "DISABLED";
export type ActionStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "STALE";

export type StaffRecord = {
  id: string;
  employeeCode: string;
  emailNormalized: string;
  displayName: string;
  passwordSalt: string | null;
  passwordDigest: string | null;
  status: StaffStatus;
  authorizationVersion: number;
  passwordChangedAt: string | null;
  mfaEnrolledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  roles: Array<{ role: AdminRole; environmentScope: string; expiresAt: string | null }>;
};

export type StaffMfaRecord = {
  id: string;
  staffId: string;
  secretCiphertext: string;
  encryptionKeyId: string;
  secretCipherVersion?: string | null;
  secretAadVersion?: string | null;
  secretEncryptionAlgorithm?: string | null;
  secretEncryptedDataKey?: string | null;
  lastAcceptedTimeStep: number | null;
};

export type StaffSessionRecord = {
  id: string;
  staffId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  familyId: string;
  authorizationVersion: number;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  lastSeenAt: string;
  csrfTokenHash: string;
  deviceFingerprint: string | null;
  ipHash: string | null;
  stepUpVerifiedAt: string | null;
  revokedAt: string | null;
};

export type StaffChallengeRecord = {
  id: string;
  staffId: string;
  purpose: "LOGIN" | "STEP_UP";
  expiresAt: string;
  attempts: number;
  consumedAt: string | null;
};

export type StaffInviteRecord = {
  id: string;
  emailNormalized: string;
  employeeCode: string;
  displayName: string;
  roleCode: AdminRole;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
};

export type AdminActionRecord = {
  id: string;
  actionType: string;
  requesterStaffId: string;
  targetType: string;
  targetId: string;
  requestFingerprint: string;
  policyVersion: string;
  status: ActionStatus;
  idempotencyKey: string;
  expectedTargetVersion: number | null;
  expectedTargetStatus: string | null;
  expiresAt: string;
  payload: Record<string, unknown>;
  resultResourceId: string | null;
  failureCode: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminDecision = {
  id: string;
  requestId: string;
  reviewerStaffId: string;
  decision: "APPROVED" | "REJECTED";
  approvedFingerprint: string;
  reasonCode: string;
  comment: string | null;
  mfaVerifiedAt: string;
  createdAt: string;
};

export type AdminAuditRecord = {
  id: string;
  actorStaffId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  reasonCode: string | null;
  requestId: string | null;
  traceId: string | null;
  correlationId: string | null;
  beforeVersion: number | null;
  afterVersion: number | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export type CustomerSummary = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  accessStatus: "ACTIVE" | "LOCKED";
  accessVersion: number;
  createdAt: string;
};

export type AdminAccount = {
  id: string;
  customerId: string;
  displayName: string;
  maskedNumber: string;
  bankName: string;
  availableMinor: string;
  currentMinor: string;
  heldMinor: string;
  status: "ACTIVE" | "BLOCKED";
  version: number;
  updatedAt: string;
};

export type AdminTransaction = {
  id: string;
  accountId: string;
  direction: "CREDIT" | "DEBIT";
  amountMinor: string;
  feeMinor: string;
  status: string;
  description: string;
  reference: string;
  occurredAt: string;
};

export type AdminApplication = {
  id: string;
  applicationType: "KYC" | "CREDIT";
  customerId: string;
  status: string;
  version: number;
  requestFingerprint: string;
  assignedStaffId: string | null;
  requestedLimitMinor?: string;
  approvedLimitMinor?: string | null;
  applicantLabel?: string;
  decisionReasonCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTransfer = {
  id: string;
  customerId: string;
  sourceAccountId: string;
  reference: string;
  amountMinor: string;
  feeMinor: string;
  currency: string;
  status: string;
  version: number;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminFraudCase = {
  id: string;
  customerId: string;
  accountId: string;
  transactionId: string;
  reasonPreview: string;
  status: string;
  severity: string;
  assignedStaffId: string | null;
  resolutionCode: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminJob = {
  id: string;
  jobType: string;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminTimelineEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  actorStaffId: string | null;
  outcome: string | null;
  reasonCode: string | null;
  metadata: Record<string, unknown>;
};

type AdminRepositorySeed = {
  staff?: StaffRecord[];
  customers?: CustomerSummary[];
  accounts?: AdminAccount[];
  transactions?: AdminTransaction[];
  applications?: AdminApplication[];
  transfers?: AdminTransfer[];
  fraudCases?: AdminFraudCase[];
  jobs?: AdminJob[];
  outboxEvents?: Array<Record<string, unknown>>;
};

export type CreateActionInput = {
  id?: string;
  actionType: string;
  requesterStaffId: string;
  targetType: string;
  targetId: string;
  requestFingerprint: string;
  policyVersion: string;
  idempotencyKey: string;
  expectedTargetVersion?: number | null;
  expectedTargetStatus?: string | null;
  expiresAt: string;
  payload: Record<string, unknown>;
};

export type ExecuteActionResult = {
  status: "SUCCEEDED" | "STALE" | "FAILED";
  resultResourceId?: string;
  failureCode?: string;
  beforeVersion?: number | null;
  afterVersion?: number | null;
};

export type AdminCaseScope = {
  staffId: string;
  scope: string;
  canSeeAll: boolean;
};

export interface AdminRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  listRoles(): Promise<Array<{ code: AdminRole; displayName: string; description: string }>>;
  listPermissions(): Promise<Array<{ code: AdminPermission; description: string }>>;
  findStaffByEmail(email: string): Promise<StaffRecord | null>;
  findStaffById(id: string): Promise<StaffRecord | null>;
  listStaff(): Promise<StaffRecord[]>;
  createStaffInvite(input: Omit<StaffInviteRecord, "usedAt"> & { createdByStaffId?: string | null }): Promise<void>;
  findInviteByHash(tokenHash: string): Promise<StaffInviteRecord | null>;
  activateInvite(input: { inviteId: string; passwordSalt: string; passwordDigest: string; staffId: string }): Promise<StaffRecord>;
  createMfaCredential(input: StaffMfaRecord): Promise<void>;
  findMfaCredential(staffId: string): Promise<StaffMfaRecord | null>;
  acceptMfaTimeStep(credentialId: string, timeStep: number): Promise<boolean>;
  createChallenge(input: StaffChallengeRecord): Promise<void>;
  findChallenge(id: string): Promise<StaffChallengeRecord | null>;
  recordChallengeFailure(id: string): Promise<number>;
  consumeChallenge(id: string): Promise<boolean>;
  createSession(input: StaffSessionRecord): Promise<void>;
  findSession(accessTokenHash: string): Promise<StaffSessionRecord | null>;
  findSessionByRefreshHash(refreshTokenHash: string): Promise<StaffSessionRecord | null>;
  touchSession(id: string, idleExpiresAt: string, stepUpVerifiedAt?: string | null): Promise<void>;
  revokeSession(id: string, reason: string): Promise<void>;
  revokeStaffSessions(staffId: string, reason: string): Promise<void>;
  listSessions(staffId: string): Promise<StaffSessionRecord[]>;
  createAction(input: CreateActionInput): Promise<AdminActionRecord>;
  findAction(id: string): Promise<AdminActionRecord | null>;
  listActions(status?: ActionStatus, scope?: AdminCaseScope): Promise<AdminActionRecord[]>;
  decideAction(input: { requestId: string; reviewerStaffId: string; decision: "APPROVED" | "REJECTED"; approvedFingerprint: string; reasonCode: string; comment?: string | null; mfaVerifiedAt: string }): Promise<AdminDecision>;
  updateActionStatus(id: string, status: ActionStatus, result?: { resourceId?: string; failureCode?: string }): Promise<AdminActionRecord>;
  executeApprovedAction(input: { requestId: string; approverStaffId: string; traceId: string }): Promise<ExecuteActionResult>;
  appendAudit(input: Omit<AdminAuditRecord, "occurredAt"> & { occurredAt?: string }): Promise<void>;
  listAudit(limit?: number): Promise<AdminAuditRecord[]>;
  findCustomers(query?: string): Promise<CustomerSummary[]>;
  findCustomer(id: string): Promise<CustomerSummary | null>;
  listCustomerAccounts(customerId: string): Promise<AdminAccount[]>;
  findAccount(id: string): Promise<AdminAccount | null>;
  listAccountTransactions(accountId: string, limit?: number): Promise<AdminTransaction[]>;
  listApplications(applicationType?: "KYC" | "CREDIT", scope?: AdminCaseScope): Promise<AdminApplication[]>;
  findApplication(applicationType: "KYC" | "CREDIT", id: string, scope?: AdminCaseScope): Promise<AdminApplication | null>;
  claimApplication(applicationType: "KYC" | "CREDIT", id: string, staffId: string): Promise<AdminApplication>;
  listTransfers(status?: string): Promise<AdminTransfer[]>;
  findTransfer(id: string): Promise<AdminTransfer | null>;
  listTransferTimeline(id: string): Promise<AdminTimelineEvent[]>;
  listFraudCases(status?: string): Promise<AdminFraudCase[]>;
  findFraudCase(id: string): Promise<AdminFraudCase | null>;
  listFraudCaseTimeline(id: string): Promise<AdminTimelineEvent[]>;
  claimFraudCase(id: string, staffId: string): Promise<AdminFraudCase>;
  addFraudNote(id: string, staffId: string, note: string): Promise<void>;
  listJobs(status?: string): Promise<AdminJob[]>;
  findJob(id: string): Promise<AdminJob | null>;
  findOutboxEvent(id: string): Promise<Record<string, unknown> | null>;
  reserveBootstrap(reservedBy: string): Promise<void>;
  /**
   * Burn any invitations created by a failed bootstrap and release the
   * singleton reservation so an operator can safely retry.
   */
  abortBootstrap(inviteIds: string[]): Promise<void>;
  completeBootstrap(): Promise<void>;
  outboxSummary(): Promise<Record<string, number>>;
  listOutboxEvents(status?: string): Promise<Array<Record<string, unknown>>>;
}

function nowIso(): string { return new Date().toISOString(); }
function normalizedEmail(email: string): string { return email.trim().toLowerCase(); }
function asNumber(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function mapApplication(row: Record<string, unknown>, applicationType: "KYC" | "CREDIT"): AdminApplication {
  return {
    id: String(row.id), applicationType, customerId: String(row.customer_id), status: String(row.status),
    version: asNumber(row.version, 1), requestFingerprint: String(row.request_fingerprint),
    assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
    requestedLimitMinor: row.requested_limit_minor === undefined ? undefined : String(row.requested_limit_minor),
    approvedLimitMinor: row.approved_limit_minor === undefined ? undefined : row.approved_limit_minor === null ? null : String(row.approved_limit_minor),
    applicantLabel: row.applicant_label === undefined ? undefined : String(row.applicant_label),
    decisionReasonCode: row.decision_reason_code ? String(row.decision_reason_code) : null,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
function mapTransfer(row: Record<string, unknown>): AdminTransfer {
  return { id: String(row.id), customerId: String(row.customer_id), sourceAccountId: String(row.source_account_id), reference: String(row.reference), amountMinor: String(row.amount_minor), feeMinor: String(row.fee_minor), currency: String(row.currency), status: String(row.status), version: asNumber(row.version, 1), lastErrorCode: row.last_error_code ? String(row.last_error_code) : null, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
}
function mapFraud(row: Record<string, unknown>): AdminFraudCase {
  return { id: String(row.id), customerId: String(row.customer_id), accountId: String(row.account_id), transactionId: String(row.transaction_id), reasonPreview: String(row.reason ?? "").slice(0, 160), status: String(row.status), severity: String(row.severity ?? "MEDIUM"), assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null, resolutionCode: row.resolution_code ? String(row.resolution_code) : null, version: asNumber(row.version, 1), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString() };
}
function maskedCustomer(row: CustomerSummary): CustomerSummary { return { ...row, email: maskEmail(row.email), phoneNumber: maskPhone(row.phoneNumber) }; }
function mapJob(row: Record<string, unknown>): AdminJob {
  return { id: String(row.id), jobType: String(row.job_type), status: String(row.status), attempts: asNumber(row.attempts), lastErrorCode: row.last_error_code ? String(row.last_error_code) : null, leaseExpiresAt: row.lease_expires_at ? new Date(String(row.lease_expires_at)).toISOString() : null, createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
}
function isCanonicalOutboxRow(row: Record<string, unknown>): boolean {
  if (String(row.aggregate_type ?? "") === "legacy" || !row.payload || (typeof row.payload === "object" && Object.keys(row.payload as object).length === 0)) return false;
  const policy = resolveEventPolicy(String(row.event_type ?? ""), asNumber(row.event_version, 1));
  if (!policy) return false;
  try {
    const envelope = validateEnvelope(row.payload);
    return envelope.eventId === String(row.id) &&
      envelope.eventType === canonicalEventName(policy) &&
      envelope.eventVersion === asNumber(row.event_version, 1) &&
      envelope.aggregate.id === String(row.aggregate_id) &&
      envelope.aggregate.type === String(row.aggregate_type) &&
      envelope.aggregate.version === asNumber(row.aggregate_version, 1);
  } catch {
    return false;
  }
}
async function insertTypedActionDetail(client: PoolClient, input: CreateActionInput, requestId: string): Promise<void> {
  const payload = input.payload;
  const reason = String(payload.reasonCode ?? "ADMIN_ACTION");
  if (input.actionType === "ACCOUNT_BLOCK" || input.actionType === "ACCOUNT_UNBLOCK") {
    await client.query("INSERT INTO account_status_change_requests (request_id, account_id, requested_status, reason_code, ticket_reference) VALUES ($1,$2,$3,$4,$5)", [requestId, input.targetId, input.actionType === "ACCOUNT_BLOCK" ? "BLOCKED" : "ACTIVE", reason, payload.ticketReference ? String(payload.ticketReference) : null]);
  } else if (input.actionType === "CUSTOMER_ACCESS_LOCK" || input.actionType === "CUSTOMER_ACCESS_UNLOCK") {
    await client.query("INSERT INTO customer_access_change_requests (request_id, customer_id, requested_status, reason_code, ticket_reference) VALUES ($1,$2,$3,$4,$5)", [requestId, input.targetId, input.actionType === "CUSTOMER_ACCESS_LOCK" ? "LOCKED" : "ACTIVE", reason, payload.ticketReference ? String(payload.ticketReference) : null]);
  } else if (input.actionType === "SIMULATION_FUNDING" || input.actionType === "SIMULATION_FUNDING_REVERSAL") {
    const amount = String(payload.amountMinor ?? "1");
    await client.query("INSERT INTO simulation_funding_requests (request_id, account_id, amount_minor, currency, reason_code, ticket_reference, description, source_transaction_id) VALUES ($1,$2,$3,'VND',$4,$5,$6,$7)", [requestId, input.targetId, amount, reason, String(payload.ticketReference ?? "ADMIN"), String(payload.description ?? "Simulation funding"), input.actionType === "SIMULATION_FUNDING_REVERSAL" ? String(payload.sourceTransactionId ?? "") : null]);
  } else if (input.actionType === "KYC_DECISION" || input.actionType === "CREDIT_DECISION") {
    await client.query("INSERT INTO application_decision_requests (request_id, application_type, application_id, decision, reason_code) VALUES ($1,$2,$3,$4,$5)", [requestId, input.actionType === "KYC_DECISION" ? "KYC" : "CREDIT", input.targetId, String(payload.decision ?? "PENDING_ACTIVATION"), reason]);
  } else if (input.actionType === "TRANSFER_OPERATION") {
    await client.query("INSERT INTO transfer_operation_requests (request_id, transfer_id, operation, reason_code) VALUES ($1,$2,$3,$4)", [requestId, input.targetId, String(payload.operation ?? "RETRY"), reason]);
  } else if (input.actionType === "FRAUD_ACTION") {
    await client.query("INSERT INTO fraud_resolution_requests (request_id, report_id, operation, resolution_code, reason_code) VALUES ($1,$2,$3,$4,$5)", [requestId, input.targetId, String(payload.operation ?? "RESOLVE"), payload.resolutionCode ? String(payload.resolutionCode) : null, reason]);
  } else if (input.actionType === "OUTBOX_REQUEUE") {
    await client.query("INSERT INTO outbox_requeue_requests (request_id, event_id, reason_code, ticket_reference) VALUES ($1,$2,$3,$4)", [requestId, input.targetId, reason, String(payload.ticketReference ?? "ADMIN")]);
  } else if (input.actionType === "JOB_RETRY") {
    await client.query("INSERT INTO job_retry_requests (request_id, job_id, reason_code, ticket_reference) VALUES ($1,$2,$3,$4)", [requestId, input.targetId, reason, String(payload.ticketReference ?? "ADMIN")]);
  } else if (input.actionType === "STAFF_ROLE_CHANGE") {
    await client.query("INSERT INTO staff_role_change_requests (request_id, staff_id, role_code, operation, environment_scope, reason_code) VALUES ($1,$2,$3,$4,$5,$6)", [requestId, input.targetId, String(payload.roleCode ?? "SUPPORT"), String(payload.operation ?? "GRANT"), String(payload.environmentScope ?? "preview"), reason]);
  } else if (input.actionType === "STAFF_INVITE") {
    await client.query("INSERT INTO staff_invite_requests (request_id, email_normalized, employee_code, display_name, role_code, reason_code) VALUES ($1, lower($2), $3, $4, $5, $6)", [requestId, String(payload.email ?? ""), String(payload.employeeCode ?? ""), String(payload.displayName ?? ""), String(payload.role ?? "SUPPORT"), reason]);
  }
}

async function insertAdminOutboxEvent(client: PoolClient, input: {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  traceId: string | null;
}): Promise<void> {
  const eventId = createId("outbox");
  const policy = resolveEventPolicy(input.eventType, 1);
  if (!policy) throw new Error(`ADMIN_OUTBOX_EVENT_UNREGISTERED:${input.eventType}`);
  assertSafePayload(input.payload);
  const envelope = buildEnvelope({
    eventId,
    eventType: input.eventType,
    eventVersion: 1,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    occurredAt: new Date().toISOString(),
    traceId: input.traceId,
  });
  const payload = { ...input.payload, ...envelope };
  await client.query(
    "INSERT INTO outbox_events (id,event_type,aggregate_id,payload,occurred_at,published_at,attempts,next_attempt_at,event_version,aggregate_type,aggregate_version,status,priority,deduplication_key,created_at,updated_at,trace_id) VALUES ($1,$2,$3,$4,NOW(),NULL,0,NOW(),$5,$6,$7,'PENDING',$8,$9,NOW(),NOW(),$10)",
    [eventId, envelope.eventType, input.aggregateId, JSON.stringify(payload), envelope.eventVersion, envelope.aggregate.type, envelope.aggregate.version, policy.priority, input.deduplicationKey, input.traceId],
  );
}

export class InMemoryAdminRepository implements AdminRepository {
  private readonly roles = new Map<AdminRole, { code: AdminRole; displayName: string; description: string }>();
  private readonly permissions = new Map<string, { code: AdminPermission; description: string }>();
  private readonly staff = new Map<string, StaffRecord>();
  private readonly invites = new Map<string, StaffInviteRecord>();
  private readonly mfa = new Map<string, StaffMfaRecord>();
  private readonly challenges = new Map<string, StaffChallengeRecord>();
  private readonly sessions = new Map<string, StaffSessionRecord>();
  private readonly actions = new Map<string, AdminActionRecord>();
  private readonly decisions = new Map<string, AdminDecision>();
  private readonly audit: AdminAuditRecord[] = [];
  private readonly customers = new Map<string, CustomerSummary>();
  private readonly accounts = new Map<string, AdminAccount>();
  private readonly transactions = new Map<string, AdminTransaction[]>();
  private readonly applications = new Map<string, AdminApplication>();
  private readonly transfers = new Map<string, AdminTransfer>();
  private readonly fraudCases = new Map<string, AdminFraudCase>();
  private readonly fraudNotes = new Map<string, AdminTimelineEvent[]>();
  private readonly jobs = new Map<string, AdminJob>();
  private readonly outboxEvents = new Map<string, Record<string, unknown>>();
  private readonly executing = new Set<string>();

  constructor(private readonly seed: AdminRepositorySeed = {}) {}

  async initialize(): Promise<void> {
    const roleDefinitions: Array<[AdminRole, string, string]> = [
      ["SUPPORT", "Hỗ trợ", "Tra cứu dữ liệu đã che"], ["OPERATIONS", "Vận hành", "Xử lý nghiệp vụ"], ["CONTROL", "Kiểm soát", "Phê duyệt độc lập"], ["ADMIN", "Quản trị", "Quản lý danh tính và policy"],
    ];
    for (const [code, displayName, description] of roleDefinitions) this.roles.set(code, { code, displayName, description });
    const { ADMIN_PERMISSIONS } = await import("../authorization/permissionRegistry.js");
    for (const code of ADMIN_PERMISSIONS) this.permissions.set(code, { code, description: code });
    for (const row of this.seed.staff ?? []) this.staff.set(row.id, structuredClone(row));
    for (const row of this.seed.customers ?? []) this.customers.set(row.id, { ...structuredClone(row), accessVersion: row.accessVersion ?? 1 });
    for (const row of this.seed.accounts ?? []) this.accounts.set(row.id, structuredClone(row));
    for (const row of this.seed.transactions ?? []) this.transactions.set(row.accountId, [structuredClone(row), ...(this.transactions.get(row.accountId) ?? [])]);
    for (const row of this.seed.applications ?? []) this.applications.set(row.id, structuredClone(row));
    for (const row of this.seed.transfers ?? []) this.transfers.set(row.id, structuredClone(row));
    for (const row of this.seed.fraudCases ?? []) this.fraudCases.set(row.id, structuredClone(row));
    for (const row of this.seed.jobs ?? []) this.jobs.set(row.id, structuredClone(row));
    for (const row of this.seed.outboxEvents ?? []) {
      const id = String(row.id ?? randomUUID());
      this.outboxEvents.set(id, { ...structuredClone(row), id, requeueable: row.requeueable === true });
    }
  }
  async close(): Promise<void> {}
  listRoles() { return Promise.resolve([...this.roles.values()]); }
  listPermissions() { return Promise.resolve([...this.permissions.values()] as Array<{ code: AdminPermission; description: string }>); }
  findStaffByEmail(email: string) { const row = [...this.staff.values()].find((item) => item.emailNormalized === normalizedEmail(email)); return Promise.resolve(row ? structuredClone(row) : null); }
  findStaffById(id: string) { const row = this.staff.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  listStaff() { return Promise.resolve([...this.staff.values()].map((row) => structuredClone(row))); }
  async createStaffInvite(input: Omit<StaffInviteRecord, "usedAt"> & { createdByStaffId?: string | null }): Promise<void> {
    const row: StaffInviteRecord = { ...input, usedAt: null };
    this.invites.set(row.tokenHash, structuredClone(row));
    const staff: StaffRecord = { id: input.id, employeeCode: input.employeeCode, emailNormalized: input.emailNormalized, displayName: input.displayName, passwordSalt: null, passwordDigest: null, status: "INVITED", authorizationVersion: 1, passwordChangedAt: null, mfaEnrolledAt: null, lastLoginAt: null, createdAt: nowIso(), roles: [{ role: input.roleCode, environmentScope: "preview", expiresAt: null }] };
    this.staff.set(staff.id, staff);
  }
  findInviteByHash(tokenHash: string) { const row = [...this.invites.values()].find((item) => item.tokenHash === tokenHash && !item.usedAt && Date.parse(item.expiresAt) > Date.now()); return Promise.resolve(row ? structuredClone(row) : null); }
  async activateInvite(input: { inviteId: string; passwordSalt: string; passwordDigest: string; staffId: string }): Promise<StaffRecord> {
    const row = [...this.invites.values()].find((item) => item.id === input.inviteId);
    const staff = this.staff.get(input.staffId);
    if (!row || !staff || row.usedAt || Date.parse(row.expiresAt) <= Date.now()) throw new Error("INVITE_INVALID");
    row.usedAt = nowIso(); staff.passwordSalt = input.passwordSalt; staff.passwordDigest = input.passwordDigest; staff.status = "ACTIVE"; staff.passwordChangedAt = nowIso();
    return structuredClone(staff);
  }
  createMfaCredential(input: StaffMfaRecord) { this.mfa.set(input.staffId, structuredClone(input)); const staff = this.staff.get(input.staffId); if (staff) staff.mfaEnrolledAt = nowIso(); return Promise.resolve(); }
  findMfaCredential(staffId: string) { const row = this.mfa.get(staffId); return Promise.resolve(row ? structuredClone(row) : null); }
  acceptMfaTimeStep(credentialId: string, timeStep: number) { const row = [...this.mfa.values()].find((item) => item.id === credentialId); if (!row || (row.lastAcceptedTimeStep !== null && timeStep <= row.lastAcceptedTimeStep)) return Promise.resolve(false); row.lastAcceptedTimeStep = timeStep; return Promise.resolve(true); }
  createChallenge(input: StaffChallengeRecord) { this.challenges.set(input.id, structuredClone(input)); return Promise.resolve(); }
  findChallenge(id: string) { const row = this.challenges.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  recordChallengeFailure(id: string) { const row = this.challenges.get(id); if (!row) return Promise.resolve(0); row.attempts += 1; return Promise.resolve(row.attempts); }
  consumeChallenge(id: string) { const row = this.challenges.get(id); if (!row || row.consumedAt || Date.parse(row.expiresAt) <= Date.now()) return Promise.resolve(false); row.consumedAt = nowIso(); return Promise.resolve(true); }
  createSession(input: StaffSessionRecord) { this.sessions.set(input.id, structuredClone(input)); return Promise.resolve(); }
  findSession(accessTokenHash: string) { const row = [...this.sessions.values()].find((item) => item.accessTokenHash === accessTokenHash); return Promise.resolve(row ? structuredClone(row) : null); }
  findSessionByRefreshHash(refreshTokenHash: string) { const row = [...this.sessions.values()].find((item) => item.refreshTokenHash === refreshTokenHash); return Promise.resolve(row ? structuredClone(row) : null); }
  touchSession(id: string, idleExpiresAt: string, stepUpVerifiedAt?: string | null) { const row = this.sessions.get(id); if (row) { row.lastSeenAt = nowIso(); row.idleExpiresAt = idleExpiresAt; if (stepUpVerifiedAt !== undefined) row.stepUpVerifiedAt = stepUpVerifiedAt; } return Promise.resolve(); }
  revokeSession(id: string, reason: string) { const row = this.sessions.get(id); if (row) { row.revokedAt = nowIso(); } void reason; return Promise.resolve(); }
  revokeStaffSessions(staffId: string, reason: string) { for (const row of this.sessions.values()) if (row.staffId === staffId && !row.revokedAt) row.revokedAt = nowIso(); void reason; return Promise.resolve(); }
  listSessions(staffId: string) { return Promise.resolve([...this.sessions.values()].filter((row) => row.staffId === staffId).map((row) => structuredClone(row))); }
  async createAction(input: CreateActionInput): Promise<AdminActionRecord> { const existing = [...this.actions.values()].find((row) => row.requesterStaffId === input.requesterStaffId && row.idempotencyKey === input.idempotencyKey); if (existing) return structuredClone(existing); const row: AdminActionRecord = { id: input.id ?? randomUUID(), actionType: input.actionType, requesterStaffId: input.requesterStaffId, targetType: input.targetType, targetId: input.targetId, requestFingerprint: input.requestFingerprint, policyVersion: input.policyVersion, status: "PENDING_APPROVAL", idempotencyKey: input.idempotencyKey, expectedTargetVersion: input.expectedTargetVersion ?? null, expectedTargetStatus: input.expectedTargetStatus ?? null, expiresAt: input.expiresAt, payload: structuredClone(input.payload), resultResourceId: null, failureCode: null, version: 1, createdAt: nowIso(), updatedAt: nowIso() }; this.actions.set(row.id, row); return structuredClone(row); }
  findAction(id: string) { const row = this.actions.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  listActions(status?: ActionStatus, scope?: AdminCaseScope) { return Promise.resolve([...this.actions.values()].filter((row) => (!status || row.status === status) && (!scope || scope.canSeeAll || row.requesterStaffId === scope.staffId)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((row) => structuredClone(row))); }
  async decideAction(input: { requestId: string; reviewerStaffId: string; decision: "APPROVED" | "REJECTED"; approvedFingerprint: string; reasonCode: string; comment?: string | null; mfaVerifiedAt: string }): Promise<AdminDecision> {
    if (this.decisions.has(input.requestId)) return structuredClone(this.decisions.get(input.requestId)!);
    const action = this.actions.get(input.requestId);
    if (!action) throw new Error("ACTION_NOT_FOUND");
    const row: AdminDecision = { id: randomUUID(), requestId: input.requestId, reviewerStaffId: input.reviewerStaffId, decision: input.decision, approvedFingerprint: input.approvedFingerprint, reasonCode: input.reasonCode, comment: input.comment ?? null, mfaVerifiedAt: input.mfaVerifiedAt, createdAt: nowIso() };
    this.decisions.set(input.requestId, row);
    action.status = input.decision === "APPROVED" ? "APPROVED" : "REJECTED";
    action.version += 1;
    action.updatedAt = nowIso();
    return structuredClone(row);
  }
  async updateActionStatus(id: string, status: ActionStatus, result: { resourceId?: string; failureCode?: string } = {}) { const row = this.actions.get(id); if (!row) throw new Error("ACTION_NOT_FOUND"); row.status = status; row.resultResourceId = result.resourceId ?? row.resultResourceId; row.failureCode = result.failureCode ?? row.failureCode; row.version += 1; row.updatedAt = nowIso(); return structuredClone(row); }
  async executeApprovedAction(input: { requestId: string; approverStaffId: string; traceId: string }): Promise<ExecuteActionResult> {
    const action = this.actions.get(input.requestId);
    if (!action) return { status: "FAILED", failureCode: "ACTION_NOT_FOUND" };
    if (action.status !== "APPROVED" || this.executing.has(action.id)) return { status: "FAILED", failureCode: "ACTION_ALREADY_DECIDED" };
    this.executing.add(action.id);
    const finish = (status: ActionStatus, resultResourceId?: string, failureCode?: string): ExecuteActionResult => {
      action.status = status;
      action.resultResourceId = resultResourceId ?? action.resultResourceId;
      action.failureCode = failureCode ?? action.failureCode;
      action.version += 1;
      action.updatedAt = nowIso();
      if (status === "STALE") return { status: "STALE", failureCode: failureCode ?? "ACTION_STALE" };
      if (status === "FAILED") return { status: "FAILED", failureCode: failureCode ?? "ACTION_EXECUTION_FAILED" };
      return { status: "SUCCEEDED", resultResourceId: resultResourceId ?? undefined };
    };
    try {
      const targetVersion = (target: Record<string, unknown> | undefined): number | null => target ? asNumber(target.version ?? target.authorizationVersion ?? target.attempts ?? target.accessVersion, 0) : null;
      const targetStatus = (target: Record<string, unknown> | undefined): string | null => target ? String(target.status ?? target.accessStatus ?? "") : null;
      let target: Record<string, unknown> | undefined;
      if (action.targetType === "ACCOUNT") target = this.accounts.get(action.targetId) as unknown as Record<string, unknown> | undefined;
      else if (action.targetType === "CUSTOMER") target = this.customers.get(action.targetId) as unknown as Record<string, unknown> | undefined;
      else if (action.targetType === "STAFF") target = this.staff.get(action.targetId) as unknown as Record<string, unknown> | undefined;
      else if (action.targetType === "KYC_APPLICATION" || action.targetType === "CREDIT_APPLICATION") target = this.applications.get(action.targetId) as unknown as Record<string, unknown> | undefined;
      else if (action.targetType === "TRANSFER") target = this.transfers.get(action.targetId) as unknown as Record<string, unknown> | undefined;
      else if (action.targetType === "FRAUD_CASE") target = this.fraudCases.get(action.targetId) as unknown as Record<string, unknown> | undefined;
      else if (action.targetType === "JOB") target = this.jobs.get(action.targetId) as unknown as Record<string, unknown> | undefined;
      else if (action.targetType === "OUTBOX_EVENT") target = this.outboxEvents.get(action.targetId);
      if (action.targetType !== "STAFF_INVITE" && !target) return finish("FAILED", undefined, `${action.targetType}_NOT_FOUND`);
      if (target && action.expectedTargetVersion !== null && targetVersion(target) !== action.expectedTargetVersion) return finish("STALE", undefined, "ACTION_STALE");
      if (target && action.expectedTargetStatus !== null && targetStatus(target) !== action.expectedTargetStatus) return finish("STALE", undefined, "ACTION_STALE");

      if (action.actionType === "CUSTOMER_ACCESS_LOCK" || action.actionType === "CUSTOMER_ACCESS_UNLOCK") {
        const customer = this.customers.get(action.targetId)!;
        const before = customer.accessVersion;
        customer.accessStatus = action.actionType === "CUSTOMER_ACCESS_LOCK" ? "LOCKED" : "ACTIVE";
        customer.accessVersion += 1;
        if (customer.accessStatus === "LOCKED") await this.revokeStaffSessions(`customer:${customer.id}`, "CUSTOMER_ACCESS_LOCK");
        return finish("SUCCEEDED", customer.id, undefined) as ExecuteActionResult & { beforeVersion?: number; afterVersion?: number };
      }
      if (action.actionType === "STAFF_INVITE") {
        const token = createOpaqueToken();
        const inviteId = randomUUID();
        await this.createStaffInvite({ id: inviteId, emailNormalized: String(action.payload.email ?? "").trim().toLowerCase(), employeeCode: String(action.payload.employeeCode ?? "").trim(), displayName: String(action.payload.displayName ?? "").trim(), roleCode: String(action.payload.role ?? "SUPPORT") as AdminRole, tokenHash: hashOpaqueToken(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), createdByStaffId: action.requesterStaffId });
        return finish("SUCCEEDED", inviteId);
      }
      if (action.actionType === "STAFF_ROLE_CHANGE") {
        const staff = this.staff.get(action.targetId)!;
        const operation = String(action.payload.operation ?? "GRANT").toUpperCase();
        const role = String(action.payload.roleCode ?? "SUPPORT") as AdminRole;
        if (operation === "GRANT" && !staff.roles.some((item) => item.role === role && item.environmentScope === String(action.payload.environmentScope ?? "preview"))) staff.roles.push({ role, environmentScope: String(action.payload.environmentScope ?? "preview"), expiresAt: null });
        if (operation === "REVOKE") staff.roles = staff.roles.filter((item) => !(item.role === role && item.environmentScope === String(action.payload.environmentScope ?? "preview")));
        staff.authorizationVersion += 1;
        await this.revokeStaffSessions(staff.id, "AUTHORIZATION_VERSION_CHANGED");
        return finish("SUCCEEDED", staff.id);
      }
      if (action.actionType === "STAFF_DISABLE") {
        const staff = this.staff.get(action.targetId)!;
        staff.status = "DISABLED";
        staff.authorizationVersion += 1;
        await this.revokeStaffSessions(staff.id, "STAFF_DISABLED");
        return finish("SUCCEEDED", staff.id);
      }
      if (action.actionType === "ACCOUNT_BLOCK" || action.actionType === "ACCOUNT_UNBLOCK") {
        const account = this.accounts.get(action.targetId)!;
        account.status = action.actionType === "ACCOUNT_BLOCK" ? "BLOCKED" : "ACTIVE";
        account.version += 1;
        account.updatedAt = nowIso();
        return finish("SUCCEEDED", account.id);
      }
      if (action.actionType === "SIMULATION_FUNDING") {
        const account = this.accounts.get(action.targetId)!;
        const amount = BigInt(String(action.payload.amountMinor ?? "0"));
        if (amount <= 0n) return finish("FAILED", undefined, "FUNDING_LIMIT_EXCEEDED");
        const before = account.version;
        account.availableMinor = String(BigInt(account.availableMinor) + amount);
        account.currentMinor = String(BigInt(account.currentMinor) + amount);
        account.version += 1;
        account.updatedAt = nowIso();
        const row: AdminTransaction = { id: randomUUID(), accountId: account.id, direction: "CREDIT", amountMinor: amount.toString(), feeMinor: "0", status: "SUCCEEDED", description: String(action.payload.description ?? "Simulation funding"), reference: `ADMIN-FUND-${action.id.slice(0, 8)}`, occurredAt: nowIso() };
        this.transactions.set(account.id, [row, ...(this.transactions.get(account.id) ?? [])]);
        const result = finish("SUCCEEDED", row.id);
        return { ...result, beforeVersion: before, afterVersion: account.version };
      }
      if (action.actionType === "KYC_DECISION" || action.actionType === "CREDIT_DECISION") {
        const application = this.applications.get(action.targetId)!;
        const decision = String(action.payload.decision);
        application.status = decision;
        application.decisionReasonCode = String(action.payload.reasonCode ?? "ADMIN_DECISION");
        if (action.actionType === "CREDIT_DECISION" && action.payload.approvedLimitMinor !== undefined) application.approvedLimitMinor = String(action.payload.approvedLimitMinor);
        application.version += 1;
        application.updatedAt = nowIso();
        return finish("SUCCEEDED", application.id);
      }
      if (action.actionType === "TRANSFER_OPERATION") {
        const transfer = this.transfers.get(action.targetId)!;
        const operation = String(action.payload.operation);
        transfer.status = operation === "CANCEL" ? "FAILED" : operation === "REVERSAL" ? "REVERSED" : "PENDING";
        transfer.lastErrorCode = operation === "CANCEL" ? "ADMIN_CANCELLED" : null;
        transfer.version += 1;
        transfer.updatedAt = nowIso();
        return finish("SUCCEEDED", transfer.id);
      }
      if (action.actionType === "FRAUD_ACTION") {
        const fraud = this.fraudCases.get(action.targetId)!;
        const operation = String(action.payload.operation);
        if (operation === "RESOLVE") {
          fraud.status = "RESOLVED";
          fraud.resolutionCode = String(action.payload.resolutionCode);
          fraud.version += 1;
          fraud.updatedAt = nowIso();
          return finish("SUCCEEDED", fraud.id);
        }
        return finish("FAILED", undefined, "FRAUD_ACTION_REQUIRES_FINANCIAL_ADAPTER");
      }
      if (action.actionType === "OUTBOX_REQUEUE") {
        const event = this.outboxEvents.get(action.targetId)!;
        if (!['DEAD', 'SKIPPED'].includes(String(event.status)) || event.requeueable !== true) return finish("FAILED", undefined, "OUTBOX_NOT_REQUEUEABLE");
        event.status = "PENDING";
        event.deadLetteredAt = null;
        event.skippedAt = null;
        event.updatedAt = nowIso();
        return finish("SUCCEEDED", action.targetId);
      }
      if (action.actionType === "JOB_RETRY") {
        const job = this.jobs.get(action.targetId)!;
        if (!['FAILED', 'DEAD'].includes(job.status)) return finish("FAILED", undefined, "JOB_NOT_RETRYABLE");
        job.status = "PENDING";
        job.leaseExpiresAt = null;
        job.updatedAt = nowIso();
        return finish("SUCCEEDED", job.id);
      }
      return finish("FAILED", undefined, "ACTION_NOT_SUPPORTED");
    } finally {
      this.executing.delete(action.id);
    }
  }
  appendAudit(input: Omit<AdminAuditRecord, "occurredAt"> & { occurredAt?: string }) { this.audit.push({ ...input, metadata: redactAdminMetadata(input.metadata) as Record<string, unknown>, occurredAt: input.occurredAt ?? nowIso() }); return Promise.resolve(); }
  listAudit(limit = 100) { return Promise.resolve(this.audit.slice(-Math.min(limit, 1000)).reverse().map((row) => structuredClone(row))); }
  findCustomers(query = "") { const term = query.trim().toLowerCase(); return Promise.resolve([...this.customers.values()].filter((row) => !term || `${row.fullName} ${row.email} ${row.phoneNumber}`.toLowerCase().includes(term)).map((row) => maskedCustomer(structuredClone(row)))); }
  findCustomer(id: string) { const row = this.customers.get(id); return Promise.resolve(row ? maskedCustomer(structuredClone(row)) : null); }
  listCustomerAccounts(customerId: string) { return Promise.resolve([...this.accounts.values()].filter((row) => row.customerId === customerId).map((row) => ({ ...structuredClone(row), maskedNumber: maskAccountNumber(row.maskedNumber) }))); }
  findAccount(id: string) { const row = this.accounts.get(id); return Promise.resolve(row ? { ...structuredClone(row), maskedNumber: maskAccountNumber(row.maskedNumber) } : null); }
  listAccountTransactions(accountId: string, limit = 100) { return Promise.resolve((this.transactions.get(accountId) ?? []).slice(0, Math.min(limit, 1000)).map((row) => structuredClone(row))); }
  listApplications(applicationType?: "KYC" | "CREDIT", scope?: AdminCaseScope) { return Promise.resolve([...this.applications.values()].filter((row) => (!applicationType || row.applicationType === applicationType) && (!scope || scope.canSeeAll || !row.assignedStaffId || row.assignedStaffId === scope.staffId)).map((row) => structuredClone(row))); }
  findApplication(applicationType: "KYC" | "CREDIT", id: string, scope?: AdminCaseScope) { const row = this.applications.get(id); return Promise.resolve(row && row.applicationType === applicationType && (!scope || scope.canSeeAll || !row.assignedStaffId || row.assignedStaffId === scope.staffId) ? structuredClone(row) : null); }
  async claimApplication(applicationType: "KYC" | "CREDIT", id: string, staffId: string): Promise<AdminApplication> { const row = this.applications.get(id); if (!row || row.applicationType !== applicationType) throw notFound("Application not found."); if (row.assignedStaffId && row.assignedStaffId !== staffId) throw conflictWithCode("CASE_ALREADY_ASSIGNED", "Case is assigned to another staff member."); if (!['SUBMITTED', 'UNDER_REVIEW'].includes(row.status)) throw conflictWithCode("CASE_STATUS_CONFLICT", "Application is not available for review."); row.assignedStaffId = staffId; row.status = "UNDER_REVIEW"; row.version += 1; row.updatedAt = nowIso(); return structuredClone(row); }
  listTransfers(status?: string) { return Promise.resolve([...this.transfers.values()].filter((row) => !status || row.status === status).map((row) => structuredClone(row))); }
  findTransfer(id: string) { const row = this.transfers.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  listTransferTimeline(id: string) { return Promise.resolve(this.audit.filter((event) => event.targetType === "TRANSFER" && event.targetId === id).map((event) => ({ id: event.id, eventType: event.action, occurredAt: event.occurredAt, actorStaffId: event.actorStaffId, outcome: event.outcome, reasonCode: event.reasonCode, metadata: structuredClone(event.metadata) })).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))); }
  listFraudCases(status?: string) { return Promise.resolve([...this.fraudCases.values()].filter((row) => !status || row.status === status).map((row) => structuredClone(row))); }
  findFraudCase(id: string) { const row = this.fraudCases.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  listFraudCaseTimeline(id: string) { return Promise.resolve([...this.audit.filter((event) => event.targetType === "FRAUD_CASE" && event.targetId === id).map((event) => ({ id: event.id, eventType: event.action, occurredAt: event.occurredAt, actorStaffId: event.actorStaffId, outcome: event.outcome, reasonCode: event.reasonCode, metadata: structuredClone(event.metadata) })), ...(this.fraudNotes.get(id) ?? []).map((event) => structuredClone(event))].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))); }
  async claimFraudCase(id: string, staffId: string): Promise<AdminFraudCase> { const row = this.fraudCases.get(id); if (!row) throw notFound("Fraud case not found."); if (row.assignedStaffId && row.assignedStaffId !== staffId) throw conflictWithCode("CASE_ALREADY_ASSIGNED", "Fraud case is assigned to another staff member."); if (!['RECEIVED', 'IN_REVIEW'].includes(row.status)) throw conflictWithCode("CASE_STATUS_CONFLICT", "Fraud case is not available for review."); row.assignedStaffId = staffId; row.status = "IN_REVIEW"; row.version += 1; row.updatedAt = nowIso(); return structuredClone(row); }
  async addFraudNote(id: string, staffId: string, note: string) { if (!this.fraudCases.has(id)) throw notFound("Fraud case not found."); const safeNote = note.replace(/[<>]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 2000); if (!safeNote) throw invalidRequest("Fraud note is required."); const event: AdminTimelineEvent = { id: randomUUID(), eventType: "FRAUD_NOTE_ADDED", occurredAt: nowIso(), actorStaffId: staffId, outcome: "SUCCEEDED", reasonCode: "INVESTIGATION_NOTE", metadata: { note: safeNote } }; this.fraudNotes.set(id, [event, ...(this.fraudNotes.get(id) ?? [])]); }
  listJobs(status?: string) { return Promise.resolve([...this.jobs.values()].filter((row) => !status || row.status === status).map((row) => structuredClone(row))); }
  findJob(id: string) { const row = this.jobs.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  findOutboxEvent(id: string) { const row = this.outboxEvents.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  private bootstrapReserved = false;
  async reserveBootstrap(_reservedBy: string) { if (this.bootstrapReserved) throw conflictWithCode("ADMIN_BOOTSTRAP_ALREADY_COMPLETED", "Admin bootstrap has already been reserved."); this.bootstrapReserved = true; }
  async abortBootstrap(inviteIds: string[]) {
    for (const invite of [...this.invites.values()]) {
      if (!inviteIds.includes(invite.id)) continue;
      const staff = this.staff.get(invite.id);
      this.invites.delete(invite.tokenHash);
      if (staff?.status === "INVITED") this.staff.delete(staff.id);
      else if (staff) {
        staff.status = "DISABLED";
        staff.authorizationVersion += 1;
      }
    }
    this.bootstrapReserved = false;
  }
  async completeBootstrap() {}
  outboxSummary() { const result: Record<string, number> = { PENDING: 0, PROCESSING: 0, DEAD: 0, SKIPPED: 0 }; for (const row of this.outboxEvents.values()) { const status = String(row.status ?? "PENDING"); result[status] = (result[status] ?? 0) + 1; } return Promise.resolve(result); }
  listOutboxEvents(status?: string) { return Promise.resolve([...this.outboxEvents.values()].filter((row) => !status || String(row.status) === status).map((row) => structuredClone(row))); }
}

function mapStaff(row: Record<string, unknown>, roles: StaffRecord["roles"] = []): StaffRecord {
  return { id: String(row.id), employeeCode: String(row.employee_code), emailNormalized: String(row.email_normalized), displayName: String(row.display_name), passwordSalt: row.password_salt ? String(row.password_salt) : null, passwordDigest: row.password_digest ? String(row.password_digest) : null, status: String(row.status) as StaffStatus, authorizationVersion: asNumber(row.authorization_version, 1), passwordChangedAt: row.password_changed_at ? new Date(String(row.password_changed_at)).toISOString() : null, mfaEnrolledAt: row.mfa_enrolled_at ? new Date(String(row.mfa_enrolled_at)).toISOString() : null, lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null, createdAt: new Date(String(row.created_at)).toISOString(), roles };
}
function mapAction(row: Record<string, unknown>): AdminActionRecord { return { id: String(row.id), actionType: String(row.action_type), requesterStaffId: String(row.requester_staff_id), targetType: String(row.target_type), targetId: String(row.target_id), requestFingerprint: String(row.request_fingerprint), policyVersion: String(row.policy_version), status: String(row.status) as ActionStatus, idempotencyKey: String(row.idempotency_key), expectedTargetVersion: row.expected_target_version === null ? null : asNumber(row.expected_target_version), expectedTargetStatus: row.expected_target_status ? String(row.expected_target_status) : null, expiresAt: new Date(String(row.expires_at)).toISOString(), payload: asRecord(row.payload), resultResourceId: row.result_resource_id ? String(row.result_resource_id) : null, failureCode: row.failure_code ? String(row.failure_code) : null, version: asNumber(row.version, 1), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }; }
function mapSession(row: Record<string, unknown>): StaffSessionRecord { return { id: String(row.id), staffId: String(row.staff_id), accessTokenHash: String(row.access_token_hash), refreshTokenHash: String(row.refresh_token_hash), familyId: String(row.family_id), authorizationVersion: asNumber(row.authorization_version, 1), idleExpiresAt: new Date(String(row.idle_expires_at)).toISOString(), absoluteExpiresAt: new Date(String(row.absolute_expires_at)).toISOString(), lastSeenAt: new Date(String(row.last_seen_at)).toISOString(), csrfTokenHash: String(row.csrf_token_hash), deviceFingerprint: row.device_fingerprint ? String(row.device_fingerprint) : null, ipHash: row.ip_hash ? String(row.ip_hash) : null, stepUpVerifiedAt: row.step_up_verified_at ? new Date(String(row.step_up_verified_at)).toISOString() : null, revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null }; }

/** PostgreSQL repository used by the separate Admin API process. */
export class PostgresAdminRepository implements AdminRepository {
  private readonly pool: DatabasePool;
  private readonly executionFault?: (stage: "after_ledger_write" | "after_outbox_write") => void | Promise<void>;
  readonly unitOfWork: UnitOfWork;
  constructor(options: { connectionString?: string; maxConnections?: number; executionFault?: (stage: "after_ledger_write" | "after_outbox_write") => void | Promise<void> } = {}) { this.pool = new DatabasePool({ connectionString: options.connectionString, max: options.maxConnections ?? 4 }); this.executionFault = options.executionFault; this.unitOfWork = new UnitOfWork(this.pool); }
  async initialize(): Promise<void> { const result = await this.pool.query("SELECT to_regclass('public.staff_users') AS table_name"); if (!result.rows[0]?.table_name) throw new Error("Admin schema is not initialized. Run npm run db:migrate."); }
  close() { return this.pool.close(); }
  async listRoles() { const result = await this.pool.query("SELECT code, display_name, description FROM staff_roles ORDER BY code"); return result.rows.map((row) => ({ code: String(row.code) as AdminRole, displayName: String(row.display_name), description: String(row.description) })); }
  async listPermissions() { const result = await this.pool.query("SELECT code, description FROM staff_permissions ORDER BY code"); return result.rows.map((row) => ({ code: String(row.code) as AdminPermission, description: String(row.description) })); }
  private async staffWithRoles(client: PoolClient, row: Record<string, unknown>): Promise<StaffRecord> { const roles = await client.query("SELECT role_code, environment_scope, expires_at FROM staff_user_roles WHERE staff_id = $1 AND revoked_at IS NULL", [row.id]); return mapStaff(row, roles.rows.map((item) => ({ role: String(item.role_code) as AdminRole, environmentScope: String(item.environment_scope), expiresAt: item.expires_at ? new Date(String(item.expires_at)).toISOString() : null }))); }
  async findStaffByEmail(email: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_users WHERE email_normalized = lower($1)", [email]); return result.rows[0] ? this.staffWithRoles(client, result.rows[0] as Record<string, unknown>) : null; }); }
  async findStaffById(id: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_users WHERE id = $1", [id]); return result.rows[0] ? this.staffWithRoles(client, result.rows[0] as Record<string, unknown>) : null; }); }
  async listStaff() { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_users ORDER BY created_at DESC"); return Promise.all(result.rows.map((row) => this.staffWithRoles(client, row as Record<string, unknown>))); }); }
  async createStaffInvite(input: Omit<StaffInviteRecord, "usedAt"> & { createdByStaffId?: string | null }): Promise<void> { await this.unitOfWork.transaction(async ({ client }) => { await client.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, status, created_by_staff_id) VALUES ($1, $2, lower($3), $4, 'INVITED', $5)", [input.id, input.employeeCode, input.emailNormalized, input.displayName, input.createdByStaffId ?? null]); await client.query("INSERT INTO staff_invites (id, email_normalized, employee_code, display_name, role_code, token_hash, expires_at, created_by_staff_id) VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8)", [input.id, input.emailNormalized, input.employeeCode, input.displayName, input.roleCode, input.tokenHash, input.expiresAt, input.createdByStaffId ?? null]); await client.query("INSERT INTO staff_user_roles (staff_id, role_code, granted_by_staff_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [input.id, input.roleCode, input.createdByStaffId ?? null]); }); }
  async findInviteByHash(tokenHash: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT id, email_normalized, employee_code, display_name, role_code, token_hash, expires_at, used_at FROM staff_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()", [tokenHash]); if (!result.rows[0]) return null; const row = result.rows[0]; return { id: String(row.id), emailNormalized: String(row.email_normalized), employeeCode: String(row.employee_code), displayName: String(row.display_name), roleCode: String(row.role_code) as AdminRole, tokenHash: String(row.token_hash), expiresAt: new Date(String(row.expires_at)).toISOString(), usedAt: null }; }); }
  async activateInvite(input: { inviteId: string; passwordSalt: string; passwordDigest: string; staffId: string }) { return this.unitOfWork.transaction(async ({ client }) => { const invite = await client.query("SELECT * FROM staff_invites WHERE id = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE", [input.inviteId]); if (!invite.rows[0]) throw new Error("INVITE_INVALID"); await client.query("UPDATE staff_invites SET used_at = NOW() WHERE id = $1", [input.inviteId]); await client.query("UPDATE staff_users SET password_salt = $2, password_digest = $3, status = 'ACTIVE', password_changed_at = NOW(), updated_at = NOW(), authorization_version = authorization_version + 1 WHERE id = $1", [input.staffId, input.passwordSalt, input.passwordDigest]); const row = await client.query("SELECT * FROM staff_users WHERE id = $1", [input.staffId]); return this.staffWithRoles(client, row.rows[0] as Record<string, unknown>); }); }
  async createMfaCredential(input: StaffMfaRecord) { await this.unitOfWork.transaction(async ({ client }) => { await client.query("INSERT INTO staff_mfa_credentials (id, staff_id, secret_ciphertext, encryption_key_id, secret_cipher_version, secret_aad_version, secret_encryption_algorithm, secret_encrypted_data_key, last_accepted_time_step) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [input.id, input.staffId, input.secretCiphertext, input.encryptionKeyId, input.secretCipherVersion ?? "v2", input.secretAadVersion ?? "aad-v1", input.secretEncryptionAlgorithm ?? "AES-256-GCM-ENVELOPE", input.secretEncryptedDataKey ?? null, input.lastAcceptedTimeStep]); await client.query("UPDATE staff_users SET mfa_enrolled_at = NOW(), updated_at = NOW(), authorization_version = authorization_version + 1 WHERE id = $1", [input.staffId]); }); }
  async findMfaCredential(staffId: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_mfa_credentials WHERE staff_id = $1 AND disabled_at IS NULL", [staffId]); if (!result.rows[0]) return null; const row = result.rows[0]; return { id: String(row.id), staffId: String(row.staff_id), secretCiphertext: String(row.secret_ciphertext), encryptionKeyId: String(row.encryption_key_id), secretCipherVersion: row.secret_cipher_version === null || row.secret_cipher_version === undefined ? null : String(row.secret_cipher_version), secretAadVersion: row.secret_aad_version === null || row.secret_aad_version === undefined ? null : String(row.secret_aad_version), secretEncryptionAlgorithm: row.secret_encryption_algorithm === null || row.secret_encryption_algorithm === undefined ? null : String(row.secret_encryption_algorithm), secretEncryptedDataKey: row.secret_encrypted_data_key === null || row.secret_encrypted_data_key === undefined ? null : String(row.secret_encrypted_data_key), lastAcceptedTimeStep: row.last_accepted_time_step === null ? null : asNumber(row.last_accepted_time_step) }; }); }
  async acceptMfaTimeStep(credentialId: string, timeStep: number) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("UPDATE staff_mfa_credentials SET last_accepted_time_step = $2 WHERE id = $1 AND disabled_at IS NULL AND (last_accepted_time_step IS NULL OR last_accepted_time_step < $2)", [credentialId, timeStep]); return (result.rowCount ?? 0) === 1; }); }
  async createChallenge(input: StaffChallengeRecord) { await this.unitOfWork.transaction(async ({ client }) => { await client.query("INSERT INTO staff_auth_challenges (id, staff_id, purpose, expires_at, attempts) VALUES ($1,$2,$3,$4,$5)", [input.id, input.staffId, input.purpose, input.expiresAt, input.attempts]); }); }
  async findChallenge(id: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_auth_challenges WHERE id = $1", [id]); if (!result.rows[0]) return null; const row = result.rows[0]; return { id: String(row.id), staffId: String(row.staff_id), purpose: String(row.purpose) as "LOGIN" | "STEP_UP", expiresAt: new Date(String(row.expires_at)).toISOString(), attempts: asNumber(row.attempts), consumedAt: row.consumed_at ? new Date(String(row.consumed_at)).toISOString() : null }; }); }
  async recordChallengeFailure(id: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("UPDATE staff_auth_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts", [id]); return asNumber(result.rows[0]?.attempts); }); }
  async consumeChallenge(id: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("UPDATE staff_auth_challenges SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW()", [id]); return (result.rowCount ?? 0) === 1; }); }
  async createSession(input: StaffSessionRecord) { await this.unitOfWork.transaction(async ({ client }) => { await client.query("INSERT INTO staff_sessions (id, staff_id, access_token_hash, refresh_token_hash, family_id, authorization_version, idle_expires_at, absolute_expires_at, last_seen_at, device_fingerprint, ip_hash, csrf_token_hash, step_up_verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [input.id, input.staffId, input.accessTokenHash, input.refreshTokenHash, input.familyId, input.authorizationVersion, input.idleExpiresAt, input.absoluteExpiresAt, input.lastSeenAt, input.deviceFingerprint, input.ipHash, input.csrfTokenHash, input.stepUpVerifiedAt]); }); }
  async findSession(accessTokenHash: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_sessions WHERE access_token_hash = $1", [accessTokenHash]); return result.rows[0] ? mapSession(result.rows[0] as Record<string, unknown>) : null; }); }
  async findSessionByRefreshHash(refreshTokenHash: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_sessions WHERE refresh_token_hash = $1", [refreshTokenHash]); return result.rows[0] ? mapSession(result.rows[0] as Record<string, unknown>) : null; }); }
  async touchSession(id: string, idleExpiresAt: string, stepUpVerifiedAt?: string | null) { await this.unitOfWork.transaction(async ({ client }) => { await client.query("UPDATE staff_sessions SET idle_expires_at = $2, last_seen_at = NOW(), step_up_verified_at = COALESCE($3::timestamptz, step_up_verified_at) WHERE id = $1 AND revoked_at IS NULL", [id, idleExpiresAt, stepUpVerifiedAt ?? null]); }); }
  async revokeSession(id: string, reason: string) { await this.unitOfWork.transaction(async ({ client }) => { await client.query("UPDATE staff_sessions SET revoked_at = NOW(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL", [id, reason]); }); }
  async revokeStaffSessions(staffId: string, reason: string) { await this.unitOfWork.transaction(async ({ client }) => { await client.query("UPDATE staff_sessions SET revoked_at = NOW(), revoked_reason = $2 WHERE staff_id = $1 AND revoked_at IS NULL", [staffId, reason]); }); }
  async listSessions(staffId: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM staff_sessions WHERE staff_id = $1 ORDER BY created_at DESC", [staffId]); return result.rows.map((row) => mapSession(row as Record<string, unknown>)); }); }
  async createAction(input: CreateActionInput) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const existing = await client.query("SELECT * FROM admin_action_requests WHERE requester_staff_id = $1 AND idempotency_key = $2", [input.requesterStaffId, input.idempotencyKey]);
      if (existing.rows[0]) return mapAction(existing.rows[0] as Record<string, unknown>);
      const requestId = input.id ?? createId("admin-action");
      const result = await client.query("INSERT INTO admin_action_requests (id, action_type, requester_staff_id, target_type, target_id, request_fingerprint, policy_version, idempotency_key, expected_target_version, expected_target_status, expires_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *", [requestId, input.actionType, input.requesterStaffId, input.targetType, input.targetId, input.requestFingerprint, input.policyVersion, input.idempotencyKey, input.expectedTargetVersion ?? null, input.expectedTargetStatus ?? null, input.expiresAt, JSON.stringify(input.payload)]);
      await insertTypedActionDetail(client, input, requestId);
      return mapAction(result.rows[0] as Record<string, unknown>);
    });
  }
  async findAction(id: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT * FROM admin_action_requests WHERE id = $1", [id]); return result.rows[0] ? mapAction(result.rows[0] as Record<string, unknown>) : null; }); }
  async listActions(status?: ActionStatus, scope?: AdminCaseScope) { return this.unitOfWork.transaction(async ({ client }) => { if (scope) await client.query("SELECT set_config('app.staff_id',$1,true), set_config('app.staff_scope',$2,true)", [scope.staffId, scope.scope]); const predicates: string[] = []; const values: unknown[] = []; if (status) { values.push(status); predicates.push(`status = $${values.length}`); } if (scope && !scope.canSeeAll) { values.push(scope.staffId); predicates.push(`requester_staff_id = $${values.length}`); } const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""; const result = await client.query(`SELECT * FROM admin_action_requests ${where} ORDER BY created_at DESC LIMIT 500`, values); return result.rows.map((row) => mapAction(row as Record<string, unknown>)); }); }
  async decideAction(input: { requestId: string; reviewerStaffId: string; decision: "APPROVED" | "REJECTED"; approvedFingerprint: string; reasonCode: string; comment?: string | null; mfaVerifiedAt: string }) { return this.unitOfWork.transaction(async ({ client }) => {
    // Serialize all checker decisions on the action row before checking the
    // unique decision record. Without this lock two simultaneous approvals
    // could both pass the preflight SELECT and race on the INSERT.
    const action = await client.query("SELECT id FROM admin_action_requests WHERE id = $1 FOR UPDATE", [input.requestId]);
    if (!action.rows[0]) throw new Error("ACTION_NOT_FOUND");
    const existing = await client.query("SELECT * FROM admin_action_decisions WHERE request_id = $1", [input.requestId]);
    if (existing.rows[0]) { const row = existing.rows[0]; return { id: String(row.id), requestId: String(row.request_id), reviewerStaffId: String(row.reviewer_staff_id), decision: String(row.decision) as "APPROVED" | "REJECTED", approvedFingerprint: String(row.approved_fingerprint), reasonCode: String(row.reason_code), comment: row.comment ? String(row.comment) : null, mfaVerifiedAt: new Date(String(row.mfa_verified_at)).toISOString(), createdAt: new Date(String(row.created_at)).toISOString() }; }
    const result = await client.query("INSERT INTO admin_action_decisions (id, request_id, reviewer_staff_id, decision, approved_fingerprint, reason_code, comment, mfa_verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [createId("admin-decision"), input.requestId, input.reviewerStaffId, input.decision, input.approvedFingerprint, input.reasonCode, input.comment ?? null, input.mfaVerifiedAt]);
    await client.query("UPDATE admin_action_requests SET status = $2, version = version + 1, updated_at = NOW() WHERE id = $1", [input.requestId, input.decision === "APPROVED" ? "APPROVED" : "REJECTED"]);
    const row = result.rows[0]; return { id: String(row.id), requestId: String(row.request_id), reviewerStaffId: String(row.reviewer_staff_id), decision: String(row.decision) as "APPROVED" | "REJECTED", approvedFingerprint: String(row.approved_fingerprint), reasonCode: String(row.reason_code), comment: row.comment ? String(row.comment) : null, mfaVerifiedAt: new Date(String(row.mfa_verified_at)).toISOString(), createdAt: new Date(String(row.created_at)).toISOString() };
  }); }
  async updateActionStatus(id: string, status: ActionStatus, result: { resourceId?: string; failureCode?: string } = {}) { return this.unitOfWork.transaction(async ({ client }) => { const row = await client.query("UPDATE admin_action_requests SET status = $2, result_resource_id = COALESCE($3, result_resource_id), failure_code = COALESCE($4, failure_code), version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING *", [id, status, result.resourceId ?? null, result.failureCode ?? null]); if (!row.rows[0]) throw new Error("ACTION_NOT_FOUND"); return mapAction(row.rows[0] as Record<string, unknown>); }); }
  async executeApprovedAction(input: { requestId: string; approverStaffId: string; traceId: string }): Promise<ExecuteActionResult> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const actionResult = await client.query("SELECT * FROM admin_action_requests WHERE id = $1 FOR UPDATE", [input.requestId]);
      if (!actionResult.rows[0]) return { status: "FAILED", failureCode: "ACTION_NOT_FOUND" };
      const action = mapAction(actionResult.rows[0] as Record<string, unknown>);
      if (action.status !== "APPROVED") return { status: "FAILED", failureCode: "ACTION_ALREADY_DECIDED" };
      if (Date.parse(action.expiresAt) <= Date.now()) { await client.query("UPDATE admin_action_requests SET status = 'EXPIRED', failure_code = 'ACTION_EXPIRED', updated_at = NOW() WHERE id = $1", [action.id]); return { status: "FAILED", failureCode: "ACTION_EXPIRED" }; }
      await client.query("UPDATE admin_action_requests SET status = 'EXECUTING', updated_at = NOW() WHERE id = $1", [action.id]);
      const attempt = createId("admin-execution");
      await client.query("INSERT INTO admin_action_execution_attempts (id, request_id, attempt_number, executor) SELECT $1, $2, COALESCE(MAX(attempt_number),0)+1, 'SYSTEM' FROM admin_action_execution_attempts WHERE request_id = $2", [attempt, action.id]);
      if (action.actionType === "CUSTOMER_ACCESS_LOCK" || action.actionType === "CUSTOMER_ACCESS_UNLOCK") {
        const target = await client.query("SELECT id, access_status, access_version FROM customers WHERE id = $1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='CUSTOMER_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "CUSTOMER_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].access_version, 1);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) { await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before }; }
        const nextStatus = action.actionType === "CUSTOMER_ACCESS_LOCK" ? "LOCKED" : "ACTIVE";
        const updated = await client.query("UPDATE customers SET access_status=$2, access_version=access_version+1 WHERE id=$1 RETURNING access_version", [action.targetId, nextStatus]);
        const after = asNumber(updated.rows[0]?.access_version, before + 1);
        if (nextStatus === "LOCKED") {
          await client.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE customer_id = $1 AND revoked_at IS NULL", [action.targetId]);
          // A customer access lock must also invalidate any in-flight login or
          // step-up challenge; otherwise a challenge created before the lock
          // could still be completed after the account was disabled.
          await client.query("UPDATE auth_challenges SET status='CANCELLED', cancelled_at=NOW(), updated_at=NOW() WHERE customer_id=$1 AND status='ACTIVE'", [action.targetId]);
        }
        await client.query("INSERT INTO customer_access_status_history (id, customer_id, before_status, after_status, actor_staff_id, request_id, reason_code) VALUES ($1,$2,$3,$4,$5,$6,$7)", [createId("customer-access-status"), action.targetId, String(target.rows[0].access_status ?? "ACTIVE"), nextStatus, input.approverStaffId, action.id, String(action.payload.reasonCode ?? "ADMIN_ACTION")]);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_CUSTOMER_ACCESS_CHANGED','STAFF',$2,$3,'CUSTOMER',$4,'SUCCEEDED',$5,$6,$7,$8,$9,$10,NOW())", [createId("audit"), input.approverStaffId, action.actionType, action.targetId, String(action.payload.reasonCode ?? "ADMIN_ACTION"), action.id, input.traceId, before, after, JSON.stringify(redactAdminMetadata({ status: nextStatus }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: after };
      }
      if (action.actionType === "ACCOUNT_BLOCK" || action.actionType === "ACCOUNT_UNBLOCK") {
        const target = await client.query("SELECT * FROM payment_accounts WHERE id = $1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='ACCOUNT_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "ACCOUNT_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].version);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) { await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before }; }
        const nextStatus = action.actionType === "ACCOUNT_BLOCK" ? "BLOCKED" : "ACTIVE";
        const updated = await client.query("UPDATE payment_accounts SET status=$2, version=version+1, updated_at=NOW() WHERE id=$1 RETURNING version", [action.targetId, nextStatus]);
        const after = asNumber(updated.rows[0]?.version, before + 1);
        await client.query("INSERT INTO account_status_history (id, account_id, before_status, after_status, actor_staff_id, request_id, reason_code, before_version, after_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [createId("account-status"), action.targetId, String(target.rows[0].status), nextStatus, input.approverStaffId, action.id, String(action.payload.reasonCode ?? "ADMIN_ACTION"), before, after]);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_ACCOUNT_STATUS_CHANGED','STAFF',$2,$3,'ACCOUNT',$4,'SUCCEEDED',$5,$6,$7,$8,$9,$10,NOW())", [createId("audit"), input.approverStaffId, action.actionType, action.targetId, String(action.payload.reasonCode ?? "ADMIN_ACTION"), action.id, input.traceId, before, after, JSON.stringify(redactAdminMetadata({ status: nextStatus }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: after };
      }
      if (action.actionType === "SIMULATION_FUNDING_REVERSAL") {
        const sourceTransactionId = String(action.payload.sourceTransactionId ?? "");
        const sourceResult = await client.query(
          "SELECT id, account_id, direction, amount_minor, fee_minor, currency, status, kind, description, reference FROM account_transactions WHERE id=$1 AND account_id=$2 FOR UPDATE",
          [sourceTransactionId, action.targetId],
        );
        if (!sourceResult.rows[0]) {
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='FUNDING_SOURCE_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='FUNDING_SOURCE_NOT_FOUND', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "FAILED", failureCode: "FUNDING_SOURCE_NOT_FOUND" };
        }
        const source = sourceResult.rows[0] as Record<string, unknown>;
        const sourceAmount = BigInt(String(source.amount_minor));
        const sourceKind = String(source.kind ?? "");
        if (String(source.direction) !== "CREDIT" || String(source.status) !== "SUCCEEDED" || !['SANDBOX_FUNDING', 'REFERENCE_FIXTURE_FUNDING'].includes(sourceKind)) {
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='FUNDING_SOURCE_NOT_REVERSIBLE', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='FUNDING_SOURCE_NOT_REVERSIBLE', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "FAILED", failureCode: "FUNDING_SOURCE_NOT_REVERSIBLE" };
        }
        const requestedAmount = BigInt(String(action.payload.amountMinor ?? "0"));
        if (requestedAmount !== sourceAmount) {
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='FUNDING_AMOUNT_MISMATCH', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='FUNDING_AMOUNT_MISMATCH', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "FAILED", failureCode: "FUNDING_AMOUNT_MISMATCH" };
        }
        const existingReversal = await client.query("SELECT reversal_transaction_id FROM simulation_funding_reversals WHERE source_transaction_id=$1", [sourceTransactionId]);
        if (existingReversal.rows[0]) {
          const reversalId = String(existingReversal.rows[0].reversal_transaction_id);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='FUNDING_ALREADY_REVERSED', finished_at=NOW() WHERE id=$1", [attempt]);
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='FUNDING_ALREADY_REVERSED', updated_at=NOW() WHERE id=$1", [action.id]);
          return { status: "FAILED", failureCode: "FUNDING_ALREADY_REVERSED", resultResourceId: reversalId };
        }
        const accountResult = await client.query("SELECT id, status, available_minor, current_minor, version FROM payment_accounts WHERE id=$1 FOR UPDATE", [action.targetId]);
        if (!accountResult.rows[0]) {
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='ACCOUNT_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='ACCOUNT_NOT_FOUND', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "FAILED", failureCode: "ACCOUNT_NOT_FOUND" };
        }
        const account = accountResult.rows[0] as Record<string, unknown>;
        const before = asNumber(account.version);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) {
          await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='ACTION_STALE', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before };
        }
        if (String(account.status) !== "ACTIVE") {
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='ACCOUNT_STATUS_CONFLICT', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='ACCOUNT_STATUS_CONFLICT', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "FAILED", failureCode: "ACCOUNT_STATUS_CONFLICT" };
        }
        if (BigInt(String(account.available_minor)) < sourceAmount) {
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='REVERSAL_REQUIRES_REVIEW', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='REVERSAL_REQUIRES_REVIEW', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "FAILED", failureCode: "REVERSAL_REQUIRES_REVIEW" };
        }
        const reversalTransactionId = createId("admin-funding-reversal-transaction");
        const reference = `ADMIN-REV-${action.id.slice(0, 8)}`;
        const journalId = createId("admin-funding-reversal-journal");
        await client.query("UPDATE payment_accounts SET available_minor=available_minor-$2, current_minor=current_minor-$2, version=version+1, updated_at=NOW() WHERE id=$1", [action.targetId, sourceAmount.toString()]);
        await client.query("INSERT INTO account_transactions (id,account_id,direction,amount_minor,fee_minor,currency,status,description,counterparty_name,reference,occurred_at,created_at,completed_at,kind) VALUES ($1,$2,'DEBIT',$3,0,'VND','SUCCEEDED',$4,'Simulation funding reversal',$5,NOW(),NOW(),NOW(),'SIMULATION_FUNDING_REVERSAL')", [reversalTransactionId, action.targetId, sourceAmount.toString(), String(action.payload.description ?? "Simulation funding reversal"), reference]);
        await client.query("INSERT INTO ledger_journals (id,aggregate_id,journal_type,currency,occurred_at,created_at) VALUES ($1,$2,'ADMIN_SIMULATION_FUNDING_REVERSAL','VND',NOW(),NOW())", [journalId, action.id]);
        await client.query("INSERT INTO ledger_entries (journal_id,line_number,account_ref,side,amount_minor,currency) VALUES ($1,1,$2,'DEBIT',$3,'VND'),($1,2,'sandbox-funding-source','CREDIT',$3,'VND')", [journalId, `payment-account:${action.targetId}`, sourceAmount.toString()]);
        await client.query("INSERT INTO simulation_funding_reversals (id,request_id,source_transaction_id,reversal_transaction_id,account_id,amount_minor) VALUES ($1,$2,$3,$4,$5,$6)", [createId("funding-reversal"), action.id, sourceTransactionId, reversalTransactionId, action.targetId, sourceAmount.toString()]);
        await insertAdminOutboxEvent(client, { eventType: "ADMIN_SIMULATION_FUNDING_REVERSAL_SUCCEEDED", aggregateType: "payment-account", aggregateId: action.targetId, aggregateVersion: before + 1, deduplicationKey: `admin-funding-reversal:${action.id}`, traceId: input.traceId, payload: { actionId: action.id, sourceTransactionId, reversalTransactionId, amountMinor: sourceAmount.toString(), currency: "VND" } });
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_SIMULATION_FUNDING_REVERSED','STAFF',$2,'SIMULATION_FUNDING_REVERSAL','ACCOUNT',$3,'SUCCEEDED',$4,$5,$6,$7,$8,$9,NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "ADMIN_ACTION"), action.id, input.traceId, before, before + 1, JSON.stringify(redactAdminMetadata({ sourceTransactionId, amountMinor: sourceAmount.toString(), currency: "VND" }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, reversalTransactionId]);
        return { status: "SUCCEEDED", resultResourceId: reversalTransactionId, beforeVersion: before, afterVersion: before + 1 };
      }
      if (action.actionType === "SIMULATION_FUNDING") {
        const target = await client.query("SELECT * FROM payment_accounts WHERE id = $1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='ACCOUNT_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "ACCOUNT_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].version); const amount = BigInt(String(action.payload.amountMinor ?? "0"));
        if (amount <= 0n || amount > 100_000_000n) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='FUNDING_LIMIT_EXCEEDED', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "FUNDING_LIMIT_EXCEEDED" }; }
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) { await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before }; }
        if (String(target.rows[0].status) !== "ACTIVE") { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='ACCOUNT_STATUS_CONFLICT', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "ACCOUNT_STATUS_CONFLICT" }; }
        const transactionId = createId("admin-funding-transaction"); const reference = `ADMIN-FUND-${action.id.slice(0, 8)}`; const journalId = createId("admin-funding-journal");
        await client.query("UPDATE payment_accounts SET available_minor=available_minor+$2, current_minor=current_minor+$2, version=version+1, updated_at=NOW() WHERE id=$1", [action.targetId, amount.toString()]);
        await client.query("INSERT INTO account_transactions (id,account_id,direction,amount_minor,fee_minor,currency,status,description,counterparty_name,reference,occurred_at,created_at,completed_at,kind) VALUES ($1,$2,'CREDIT',$3,0,'VND','SUCCEEDED',$4,'Simulation funding',$5,NOW(),NOW(),NOW(),'SANDBOX_FUNDING')", [transactionId, action.targetId, amount.toString(), String(action.payload.description ?? "Simulation funding"), reference]);
        await client.query("INSERT INTO ledger_journals (id,aggregate_id,journal_type,currency,occurred_at,created_at) VALUES ($1,$2,'ADMIN_SIMULATION_FUNDING','VND',NOW(),NOW())", [journalId, action.id]);
        await client.query("INSERT INTO ledger_entries (journal_id,line_number,account_ref,side,amount_minor,currency) VALUES ($1,1,'sandbox-funding-source','DEBIT',$2,'VND'),($1,2,$3,'CREDIT',$2,'VND')", [journalId, amount.toString(), `payment-account:${action.targetId}`]);
        await this.executionFault?.("after_ledger_write");
        await insertAdminOutboxEvent(client, { eventType: "ADMIN_SIMULATION_FUNDING_SUCCEEDED", aggregateType: "payment-account", aggregateId: action.targetId, aggregateVersion: before + 1, deduplicationKey: `admin-funding:${action.id}`, traceId: input.traceId, payload: { actionId: action.id, transactionId, reference, amountMinor: amount.toString(), currency: "VND" } });
        await this.executionFault?.("after_outbox_write");
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_SIMULATION_FUNDING_SUCCEEDED','STAFF',$2,'SIMULATION_FUNDING','ACCOUNT',$3,'SUCCEEDED',$4,$5,$6,$7,$8,$9,NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "ADMIN_ACTION"), action.id, input.traceId, before, before + 1, JSON.stringify(redactAdminMetadata({ amountMinor: amount.toString(), currency: "VND" }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, transactionId]);
        return { status: "SUCCEEDED", resultResourceId: transactionId, beforeVersion: before, afterVersion: before + 1 };
      }
      if (action.actionType === "KYC_DECISION" || action.actionType === "CREDIT_DECISION") {
        const applicationType = action.actionType === "KYC_DECISION" ? "KYC" : "CREDIT";
        const table = applicationType === "KYC" ? "kyc_applications" : "credit_applications";
        const target = await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='APPLICATION_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "APPLICATION_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].version, 1);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) { await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before }; }
        const decision = String(action.payload.decision ?? "");
        const update = applicationType === "KYC"
          ? await client.query("UPDATE kyc_applications SET status=$2, decision_reason_code=$3, decision_at=NOW(), version=version+1, updated_at=NOW() WHERE id=$1 RETURNING version", [action.targetId, decision, String(action.payload.reasonCode ?? "ADMIN_DECISION")])
          : await client.query("UPDATE credit_applications SET status=$2, approved_limit_minor=CASE WHEN $3='PENDING_ACTIVATION' THEN COALESCE($4, requested_limit_minor) ELSE approved_limit_minor END, decision_reason_code=$5, decision_at=NOW(), version=version+1, updated_at=NOW() WHERE id=$1 RETURNING version", [action.targetId, decision, decision, action.payload.approvedLimitMinor ? String(action.payload.approvedLimitMinor) : null, String(action.payload.reasonCode ?? "ADMIN_DECISION")]);
        const after = asNumber(update.rows[0]?.version, before + 1);
        if (applicationType === "KYC") await client.query("INSERT INTO kyc_reviews (id, application_id, reviewer_staff_id, recommendation, application_version, request_fingerprint, reason_code) VALUES ($1,$2,$3,$4,$5,$6,$7)", [createId("kyc-review"), action.targetId, input.approverStaffId, decision, before, action.requestFingerprint, String(action.payload.reasonCode ?? "ADMIN_DECISION")]);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,$2,'STAFF',$3,$4,$5,$6,'SUCCEEDED',$7,$8,$9,$10,$11,$12,NOW())", [createId("audit"), `${applicationType}_DECISION_APPROVED`, input.approverStaffId, action.actionType, applicationType, action.targetId, String(action.payload.reasonCode ?? "ADMIN_DECISION"), action.id, input.traceId, before, after, JSON.stringify(redactAdminMetadata({ decision }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: after };
      }
      if (action.actionType === "TRANSFER_OPERATION") {
        const target = await client.query("SELECT * FROM transfers WHERE id=$1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='TRANSFER_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "TRANSFER_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].version, 1);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) { await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before }; }
        const operation = String(action.payload.operation ?? "");
        if (operation === "REVERSAL") {
          if (String(target.rows[0].status) !== "SUCCEEDED" || Boolean(target.rows[0].refunded)) {
            await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='TRANSFER_NOT_REVERSIBLE', updated_at=NOW() WHERE id=$1", [action.id]);
            return { status: "FAILED", failureCode: "TRANSFER_NOT_REVERSIBLE" };
          }
          const sourceAccountId = String(target.rows[0].source_account_id);
          const destinationAccountId = target.rows[0].destination_account_id ? String(target.rows[0].destination_account_id) : "";
          const sourceTransactionId = target.rows[0].source_transaction_id ? String(target.rows[0].source_transaction_id) : "";
          const destinationTransactionId = target.rows[0].destination_transaction_id ? String(target.rows[0].destination_transaction_id) : "";
          if (!destinationAccountId || !sourceTransactionId || !destinationTransactionId || sourceAccountId === destinationAccountId) {
            await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='TRANSFER_LEGACY_DATA_INCOMPLETE', updated_at=NOW() WHERE id=$1", [action.id]);
            return { status: "FAILED", failureCode: "TRANSFER_LEGACY_DATA_INCOMPLETE" };
          }
          const accounts = await client.query("SELECT id, status, available_minor, current_minor, version FROM payment_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[sourceAccountId, destinationAccountId]]);
          const sourceAccount = accounts.rows.find((row) => String(row.id) === sourceAccountId) as Record<string, unknown> | undefined;
          const destinationAccount = accounts.rows.find((row) => String(row.id) === destinationAccountId) as Record<string, unknown> | undefined;
          if (!sourceAccount || !destinationAccount) {
            await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='TRANSFER_ACCOUNT_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]);
            return { status: "FAILED", failureCode: "TRANSFER_ACCOUNT_NOT_FOUND" };
          }
          const amount = BigInt(String(target.rows[0].amount_minor));
          const fee = BigInt(String(target.rows[0].fee_minor));
          if (BigInt(String(destinationAccount.available_minor)) < amount) {
            await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='REVERSAL_REQUIRES_REVIEW', updated_at=NOW() WHERE id=$1", [action.id]);
            return { status: "FAILED", failureCode: "REVERSAL_REQUIRES_REVIEW" };
          }
          const sourceReversalId = createId("admin-transfer-source-reversal");
          const destinationReversalId = createId("admin-transfer-destination-reversal");
          const reference = `ADMIN-TRANSFER-REV-${action.id.slice(0, 8)}`;
          const journalId = createId("admin-transfer-reversal-journal");
          await client.query("UPDATE payment_accounts SET available_minor=available_minor+$2, current_minor=current_minor+$2, version=version+1, updated_at=NOW() WHERE id=$1", [sourceAccountId, (amount + fee).toString()]);
          await client.query("UPDATE payment_accounts SET available_minor=available_minor-$2, current_minor=current_minor-$2, version=version+1, updated_at=NOW() WHERE id=$1", [destinationAccountId, amount.toString()]);
          const description = String(action.payload.description ?? "Admin transfer reversal");
          await client.query("INSERT INTO account_transactions (id,account_id,transfer_id,direction,amount_minor,fee_minor,currency,status,description,counterparty_name,reference,occurred_at,created_at,completed_at,kind) VALUES ($1,$2,$3,'CREDIT',$4,$5,'VND','SUCCEEDED',$6,$7,$8,NOW(),NOW(),NOW(),'TRANSFER_REVERSAL')", [sourceReversalId, sourceAccountId, action.targetId, amount.toString(), fee.toString(), description, "Admin transfer reversal", reference]);
          await client.query("INSERT INTO account_transactions (id,account_id,transfer_id,direction,amount_minor,fee_minor,currency,status,description,counterparty_name,reference,occurred_at,created_at,completed_at,kind) VALUES ($1,$2,$3,'DEBIT',$4,0,'VND','SUCCEEDED',$5,$6,$7,NOW(),NOW(),NOW(),'TRANSFER_REVERSAL')", [destinationReversalId, destinationAccountId, action.targetId, amount.toString(), description, "Admin transfer reversal", reference]);
          await client.query("INSERT INTO ledger_journals (id,aggregate_id,journal_type,currency,occurred_at,created_at) VALUES ($1,$2,'ADMIN_TRANSFER_REVERSAL','VND',NOW(),NOW())", [journalId, action.id]);
          if (fee > 0n) {
            await client.query("INSERT INTO ledger_entries (journal_id,line_number,account_ref,side,amount_minor,currency) VALUES ($1,1,$2,'DEBIT',$3,'VND'),($1,2,$4,'DEBIT',$5,'VND'),($1,3,$6,'CREDIT',$7,'VND')", [journalId, `payment-account:${destinationAccountId}`, amount.toString(), "fee-income:VND", fee.toString(), `payment-account:${sourceAccountId}`, (amount + fee).toString()]);
          } else {
            await client.query("INSERT INTO ledger_entries (journal_id,line_number,account_ref,side,amount_minor,currency) VALUES ($1,1,$2,'DEBIT',$3,'VND'),($1,2,$4,'CREDIT',$3,'VND')", [journalId, `payment-account:${destinationAccountId}`, amount.toString(), `payment-account:${sourceAccountId}`]);
          }
          await client.query("UPDATE account_transactions SET status='REVERSED', completed_at=NOW() WHERE id = ANY($1::uuid[])", [[sourceTransactionId, destinationTransactionId]]);
          const update = await client.query("UPDATE transfers SET status='REVERSED', refunded=true, version=version+1, updated_at=NOW() WHERE id=$1 RETURNING version", [action.targetId]);
          const after = asNumber(update.rows[0]?.version, before + 1);
          await insertAdminOutboxEvent(client, { eventType: "ADMIN_TRANSFER_REVERSAL_SUCCEEDED", aggregateType: "transfer", aggregateId: action.targetId, aggregateVersion: after, deduplicationKey: `admin-transfer-reversal:${action.id}`, traceId: input.traceId, payload: { actionId: action.id, sourceReversalId, destinationReversalId, amountMinor: amount.toString(), feeMinor: fee.toString(), currency: "VND" } });
          await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_TRANSFER_REVERSED','STAFF',$2,'TRANSFER_REVERSAL','TRANSFER',$3,'SUCCEEDED',$4,$5,$6,$7,$8,$9,NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "ADMIN_OPERATION"), action.id, input.traceId, before, after, JSON.stringify(redactAdminMetadata({ amountMinor: amount.toString(), feeMinor: fee.toString(), sourceReversalId, destinationReversalId }))]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
          await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
          return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: after };
        }
        if (operation === "CANCEL" && String(target.rows[0].status) !== "PENDING") { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='TRANSFER_NOT_CANCELABLE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "TRANSFER_NOT_CANCELABLE" }; }
        if (operation === "RETRY" && !['PENDING', 'FAILED'].includes(String(target.rows[0].status))) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='TRANSFER_NOT_RETRYABLE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "TRANSFER_NOT_RETRYABLE" }; }
        const nextStatus = operation === "CANCEL" ? "FAILED" : "PENDING";
        const nextError = operation === "CANCEL" ? "ADMIN_CANCELLED" : null;
        const update = await client.query("UPDATE transfers SET status=$2, last_error_code=$3, version=version+1, updated_at=NOW() WHERE id=$1 RETURNING version", [action.targetId, nextStatus, nextError]);
        const after = asNumber(update.rows[0]?.version, before + 1);
        await insertAdminOutboxEvent(client, { eventType: "ADMIN_TRANSFER_OPERATION_REQUESTED", aggregateType: "transfer", aggregateId: action.targetId, aggregateVersion: after, deduplicationKey: `admin-transfer:${action.id}`, traceId: input.traceId, payload: { actionId: action.id, operation } });
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_TRANSFER_OPERATION_SUCCEEDED','STAFF',$2,$3,'TRANSFER',$4,'SUCCEEDED',$5,$6,$7,$8,$9,$10,NOW())", [createId("audit"), input.approverStaffId, operation, action.targetId, String(action.payload.reasonCode ?? "ADMIN_OPERATION"), action.id, input.traceId, before, after, JSON.stringify(redactAdminMetadata({ operation, status: nextStatus }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: after };
      }
      if (action.actionType === "FRAUD_ACTION") {
        const target = await client.query("SELECT * FROM fraud_reports WHERE id=$1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='FRAUD_CASE_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "FRAUD_CASE_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].version, 1);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) { await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before }; }
        const operation = String(action.payload.operation ?? "");
        if (operation !== "RESOLVE") { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='FRAUD_ACTION_REQUIRES_DOMAIN_ADAPTER', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "FRAUD_ACTION_REQUIRES_DOMAIN_ADAPTER" }; }
        const resolutionCode = String(action.payload.resolutionCode ?? "");
        const update = await client.query("UPDATE fraud_reports SET status='RESOLVED', resolution_code=$2, version=version+1, updated_at=NOW() WHERE id=$1 RETURNING version", [action.targetId, resolutionCode]);
        const after = asNumber(update.rows[0]?.version, before + 1);
        await client.query("INSERT INTO fraud_case_actions (id, report_id, request_id, action_type, resolution_code, status, actor_staff_id) VALUES ($1,$2,$3,'RESOLVE',$4,'EXECUTED',$5)", [createId("fraud-action"), action.targetId, action.id, resolutionCode, input.approverStaffId]);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_FRAUD_RESOLVED','STAFF',$2,'FRAUD_RESOLVE','FRAUD_CASE',$3,'SUCCEEDED',$4,$5,$6,$7,$8,$9,NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "FRAUD_RESOLUTION"), action.id, input.traceId, before, after, JSON.stringify(redactAdminMetadata({ resolutionCode }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: after };
      }
      if (action.actionType === "OUTBOX_REQUEUE") {
        const target = await client.query("SELECT id, status, attempts, event_type, event_version, aggregate_type, aggregate_id, aggregate_version, deduplication_key, payload FROM outbox_events WHERE id=$1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='OUTBOX_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "OUTBOX_NOT_FOUND" }; }
        const row = target.rows[0];
        if (!['DEAD', 'SKIPPED'].includes(String(row.status)) || !isCanonicalOutboxRow(row as Record<string, unknown>)) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='OUTBOX_NOT_REQUEUEABLE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "OUTBOX_NOT_REQUEUEABLE" }; }
        const inFlight = await client.query("SELECT 1 FROM outbox_events WHERE deduplication_key=$1 AND id<>$2 AND status='PROCESSING' LIMIT 1", [row.deduplication_key, action.targetId]);
        if (inFlight.rowCount) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='OUTBOX_REQUEUE_IN_FLIGHT', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "OUTBOX_REQUEUE_IN_FLIGHT" }; }
        const before = asNumber(row.attempts); const update = await client.query("UPDATE outbox_events SET status='PENDING', next_attempt_at=NOW(), locked_by=NULL, locked_at=NULL, lease_expires_at=NULL, dead_lettered_at=NULL, skipped_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING attempts", [action.targetId]);
        const after = asNumber(update.rows[0]?.attempts, before);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_OUTBOX_REQUEUED','STAFF',$2,'OUTBOX_REQUEUE','OUTBOX_EVENT',$3,'SUCCEEDED',$4,$5,$6,$7,$8,$9,NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "OUTBOX_REQUEUE"), action.id, input.traceId, before, after, JSON.stringify(redactAdminMetadata({ eventType: row.event_type }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: after };
      }
      if (action.actionType === "JOB_RETRY") {
        const target = await client.query("SELECT id, status, attempts FROM background_jobs WHERE id=$1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='JOB_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "JOB_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].attempts);
        if (!['FAILED', 'DEAD'].includes(String(target.rows[0].status))) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='JOB_NOT_RETRYABLE', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "JOB_NOT_RETRYABLE" }; }
        await client.query("UPDATE background_jobs SET status='PENDING', lease_expires_at=NULL, updated_at=NOW() WHERE id=$1", [action.targetId]);
        await client.query("INSERT INTO job_retry_history (id, job_id, request_id, previous_status, new_status) VALUES ($1,$2,$3,$4,'PENDING')", [createId("job-retry"), action.targetId, action.id, String(target.rows[0].status)]);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_JOB_REQUEUED','STAFF',$2,'JOB_RETRY','JOB',$3,'SUCCEEDED',$4,$5,$6,$7,$8,$9,NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "JOB_RETRY"), action.id, input.traceId, before, before, JSON.stringify(redactAdminMetadata({ status: "PENDING" }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: before };
      }
      if (action.actionType === "STAFF_INVITE") {
        const email = String(action.payload.email ?? "").trim().toLowerCase();
        const employeeCode = String(action.payload.employeeCode ?? "").trim();
        const displayName = String(action.payload.displayName ?? "").trim();
        const roleCode = String(action.payload.role ?? "");
        if (!['SUPPORT', 'OPERATIONS', 'CONTROL', 'ADMIN'].includes(roleCode)) {
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='STAFF_ROLE_INVALID', finished_at=NOW() WHERE id=$1", [attempt]);
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='STAFF_ROLE_INVALID', updated_at=NOW() WHERE id=$1", [action.id]);
          return { status: "FAILED", failureCode: "STAFF_ROLE_INVALID" };
        }
        const duplicate = await client.query("SELECT id FROM staff_users WHERE email_normalized=$1 OR employee_code=$2 FOR UPDATE", [email, employeeCode]);
        if (duplicate.rows[0]) {
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='STAFF_ALREADY_EXISTS', finished_at=NOW() WHERE id=$1", [attempt]);
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='STAFF_ALREADY_EXISTS', updated_at=NOW() WHERE id=$1", [action.id]);
          return { status: "FAILED", failureCode: "STAFF_ALREADY_EXISTS" };
        }
        const inviteId = createId("staff-invite");
        // Only a hash is persisted.  A delivery provider should consume the
        // outbox event; the plaintext invitation is never put in the action,
        // audit, database or response.
        const inviteTokenHash = hashOpaqueToken(createOpaqueToken());
        await client.query("INSERT INTO staff_users (id, employee_code, email_normalized, display_name, status, created_by_staff_id) VALUES ($1,$2,$3,$4,'INVITED',$5)", [inviteId, employeeCode, email, displayName, action.requesterStaffId]);
        await client.query("INSERT INTO staff_invites (id, email_normalized, employee_code, display_name, role_code, token_hash, expires_at, created_by_staff_id) VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '24 hours',$7)", [inviteId, email, employeeCode, displayName, roleCode, inviteTokenHash, action.requesterStaffId]);
        await client.query("INSERT INTO staff_user_roles (staff_id, role_code, environment_scope, granted_by_staff_id, approved_by_staff_id) VALUES ($1,$2,'preview',$3,$4)", [inviteId, roleCode, action.requesterStaffId, input.approverStaffId]);
        await insertAdminOutboxEvent(client, { eventType: "STAFF_INVITE_CREATED", aggregateType: "staff", aggregateId: inviteId, aggregateVersion: 1, deduplicationKey: `staff-invite:${action.id}`, traceId: input.traceId, payload: { actionId: action.id, inviteId, email, employeeCode, role: roleCode } });
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_STAFF_INVITE_CREATED','STAFF',$2,'STAFF_INVITE','STAFF_INVITE',$3,'SUCCEEDED',$4,$5,$6,NULL,NULL,$7,NOW())", [createId("audit"), input.approverStaffId, inviteId, String(action.payload.reasonCode ?? "STAFF_INVITE"), action.id, input.traceId, JSON.stringify(redactAdminMetadata({ email, employeeCode, role: roleCode }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, inviteId]);
        return { status: "SUCCEEDED", resultResourceId: inviteId };
      }
      if (action.actionType === "STAFF_ROLE_CHANGE") {
        const target = await client.query("SELECT id, status, authorization_version, version FROM staff_users WHERE id=$1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='STAFF_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "STAFF_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].authorization_version, 1);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) {
          await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='ACTION_STALE', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before };
        }
        const operation = String(action.payload.operation ?? "GRANT");
        const roleCode = String(action.payload.roleCode ?? "SUPPORT");
        const scope = String(action.payload.environmentScope ?? "preview");
        if (operation === "GRANT") await client.query("INSERT INTO staff_user_roles (staff_id, role_code, environment_scope, granted_by_staff_id, approved_by_staff_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (staff_id, role_code, environment_scope) DO UPDATE SET revoked_at=NULL, granted_by_staff_id=EXCLUDED.granted_by_staff_id, approved_by_staff_id=EXCLUDED.approved_by_staff_id", [action.targetId, roleCode, scope, action.requesterStaffId, input.approverStaffId]);
        else await client.query("UPDATE staff_user_roles SET revoked_at=NOW(), approved_by_staff_id=$4 WHERE staff_id=$1 AND role_code=$2 AND environment_scope=$3 AND revoked_at IS NULL", [action.targetId, roleCode, scope, input.approverStaffId]);
        await client.query("UPDATE staff_users SET authorization_version=authorization_version+1, version=version+1, updated_at=NOW() WHERE id=$1", [action.targetId]);
        await client.query("UPDATE staff_sessions SET revoked_at=NOW(), revoked_reason='AUTHORIZATION_VERSION_CHANGED' WHERE staff_id=$1 AND revoked_at IS NULL", [action.targetId]);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_STAFF_ROLE_CHANGED','STAFF',$2,'STAFF_ROLE_CHANGE','STAFF',$3,'SUCCEEDED',$4,$5,$6,$7,$8,$9,NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "ROLE_CHANGE"), action.id, input.traceId, before, before + 1, JSON.stringify(redactAdminMetadata({ operation, roleCode, scope }))]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: before + 1 };
      }
      if (action.actionType === "STAFF_DISABLE") {
        const target = await client.query("SELECT id, status, authorization_version FROM staff_users WHERE id=$1 FOR UPDATE", [action.targetId]);
        if (!target.rows[0]) { await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='STAFF_NOT_FOUND', updated_at=NOW() WHERE id=$1", [action.id]); return { status: "FAILED", failureCode: "STAFF_NOT_FOUND" }; }
        const before = asNumber(target.rows[0].authorization_version, 1);
        if (action.expectedTargetVersion !== null && before !== action.expectedTargetVersion) {
          await client.query("UPDATE admin_action_requests SET status='STALE', failure_code='ACTION_STALE', updated_at=NOW() WHERE id=$1", [action.id]);
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='ACTION_STALE', finished_at=NOW() WHERE id=$1", [attempt]);
          return { status: "STALE", failureCode: "ACTION_STALE", beforeVersion: before };
        }
        await client.query("UPDATE staff_users SET status='DISABLED', authorization_version=authorization_version+1, version=version+1, updated_at=NOW() WHERE id=$1", [action.targetId]);
        await client.query("UPDATE staff_sessions SET revoked_at=NOW(), revoked_reason='STAFF_DISABLED' WHERE staff_id=$1 AND revoked_at IS NULL", [action.targetId]);
        await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_STAFF_DISABLED','STAFF',$2,'STAFF_DISABLE','STAFF',$3,'SUCCEEDED',$4,$5,$6,$7,$8,'{}',NOW())", [createId("audit"), input.approverStaffId, action.targetId, String(action.payload.reasonCode ?? "STAFF_DISABLE"), action.id, input.traceId, before, before + 1]);
        await client.query("UPDATE admin_action_execution_attempts SET outcome='SUCCEEDED', finished_at=NOW() WHERE id=$1", [attempt]);
        await client.query("UPDATE admin_action_requests SET status='SUCCEEDED', result_resource_id=$2, updated_at=NOW() WHERE id=$1", [action.id, action.targetId]);
        return { status: "SUCCEEDED", resultResourceId: action.targetId, beforeVersion: before, afterVersion: before + 1 };
      }
      await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='ACTION_NOT_SUPPORTED', finished_at=NOW() WHERE id=$1", [attempt]);
      await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='ACTION_NOT_SUPPORTED', updated_at=NOW() WHERE id=$1", [action.id]);
      return { status: "FAILED", failureCode: "ACTION_NOT_SUPPORTED" };
    });
  }
  async appendAudit(input: Omit<AdminAuditRecord, "occurredAt"> & { occurredAt?: string }) { await this.unitOfWork.transaction(async ({ client }) => { await client.query("INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,correlation_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_AUDIT_EVENT','STAFF',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)", [input.id, input.actorStaffId, input.action, input.targetType, input.targetId, input.outcome, input.reasonCode, input.requestId, input.traceId, input.correlationId, input.beforeVersion, input.afterVersion, JSON.stringify(redactAdminMetadata(input.metadata)), input.occurredAt ?? nowIso()]); }); }
  async listAudit(limit = 100) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT id, actor_staff_id, action, target_type, target_id, outcome, reason_code, request_id, trace_id, correlation_id, before_version, after_version, payload, occurred_at FROM audit_events WHERE actor_type='STAFF' ORDER BY occurred_at DESC LIMIT $1", [Math.min(limit, 1000)]); return result.rows.map((row) => ({ id: String(row.id), actorStaffId: row.actor_staff_id ? String(row.actor_staff_id) : null, action: String(row.action ?? row.event_type), targetType: row.target_type ? String(row.target_type) : null, targetId: row.target_id ? String(row.target_id) : null, outcome: String(row.outcome ?? "UNKNOWN"), reasonCode: row.reason_code ? String(row.reason_code) : null, requestId: row.request_id ? String(row.request_id) : null, traceId: row.trace_id ? String(row.trace_id) : null, correlationId: row.correlation_id ? String(row.correlation_id) : null, beforeVersion: row.before_version === null ? null : asNumber(row.before_version), afterVersion: row.after_version === null ? null : asNumber(row.after_version), metadata: redactAdminMetadata(asRecord(row.payload)) as Record<string, unknown>, occurredAt: new Date(String(row.occurred_at)).toISOString() })); }); }
  async findCustomers(query = "") { return this.unitOfWork.transaction(async ({ client }) => { const term = `%${query.trim().toLowerCase()}%`; const result = await client.query("SELECT id, full_name, email, phone_number, COALESCE(access_status,'ACTIVE') AS access_status, COALESCE(access_version,1) AS access_version, created_at FROM customers WHERE ($1 = '%%' OR lower(full_name) LIKE $1 OR lower(email) LIKE $1 OR phone_number LIKE $1) ORDER BY created_at DESC LIMIT 100", [term]); return result.rows.map((row) => maskedCustomer({ id: String(row.id), fullName: String(row.full_name), email: String(row.email), phoneNumber: String(row.phone_number), accessStatus: String(row.access_status) as "ACTIVE" | "LOCKED", accessVersion: asNumber(row.access_version, 1), createdAt: new Date(String(row.created_at)).toISOString() })); }); }
  async findCustomer(id: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT id, full_name, email, phone_number, COALESCE(access_status,'ACTIVE') AS access_status, COALESCE(access_version,1) AS access_version, created_at FROM customers WHERE id=$1", [id]); const row = result.rows[0]; return row ? maskedCustomer({ id: String(row.id), fullName: String(row.full_name), email: String(row.email), phoneNumber: String(row.phone_number), accessStatus: String(row.access_status) as "ACTIVE" | "LOCKED", accessVersion: asNumber(row.access_version, 1), createdAt: new Date(String(row.created_at)).toISOString() }) : null; }); }
  async listCustomerAccounts(customerId: string) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT id, customer_id, display_name, masked_number, bank_name, available_minor, current_minor, held_minor, status, version, updated_at FROM payment_accounts WHERE customer_id=$1 ORDER BY updated_at DESC", [customerId]); return result.rows.map((row) => ({ id: String(row.id), customerId: String(row.customer_id), displayName: String(row.display_name), maskedNumber: maskAccountNumber(String(row.masked_number)), bankName: String(row.bank_name ?? "Ngân hàng reference"), availableMinor: String(row.available_minor), currentMinor: String(row.current_minor), heldMinor: String(row.held_minor), status: String(row.status) as "ACTIVE" | "BLOCKED", version: asNumber(row.version), updatedAt: new Date(String(row.updated_at)).toISOString() })); }); }
  async findAccount(id: string) { const result = await this.unitOfWork.transaction(({ client }) => client.query("SELECT id, customer_id, display_name, masked_number, bank_name, available_minor, current_minor, held_minor, status, version, updated_at FROM payment_accounts WHERE id=$1", [id])); const row = result.rows[0]; return row ? { id: String(row.id), customerId: String(row.customer_id), displayName: String(row.display_name), maskedNumber: maskAccountNumber(String(row.masked_number)), bankName: String(row.bank_name ?? "Ngân hàng reference"), availableMinor: String(row.available_minor), currentMinor: String(row.current_minor), heldMinor: String(row.held_minor), status: String(row.status) as "ACTIVE" | "BLOCKED", version: asNumber(row.version), updatedAt: new Date(String(row.updated_at)).toISOString() } : null; }
  async listAccountTransactions(accountId: string, limit = 100) { return this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("SELECT id, account_id, direction, amount_minor, fee_minor, status, description, reference, occurred_at FROM account_transactions WHERE account_id=$1 ORDER BY occurred_at DESC, id DESC LIMIT $2", [accountId, Math.min(limit, 1000)]); return result.rows.map((row) => ({ id: String(row.id), accountId: String(row.account_id), direction: String(row.direction) as "CREDIT" | "DEBIT", amountMinor: String(row.amount_minor), feeMinor: String(row.fee_minor), status: String(row.status), description: String(row.description), reference: String(row.reference), occurredAt: new Date(String(row.occurred_at)).toISOString() })); }); }
  async listApplications(applicationType?: "KYC" | "CREDIT", scope?: AdminCaseScope) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const rows: AdminApplication[] = [];
      if (scope) await client.query("SELECT set_config('app.staff_id',$1,true), set_config('app.staff_scope',$2,true)", [scope.staffId, scope.scope]);
      const scoped = scope && !scope.canSeeAll;
      const scopeClause = scoped ? " WHERE assigned_staff_id=$1 OR assigned_staff_id IS NULL" : "";
      const scopeValues = scoped ? [scope!.staffId] : [];
      if (!applicationType || applicationType === "KYC") {
        const result = await client.query(`SELECT id, customer_id, status, applicant_label, request_fingerprint, assigned_staff_id, decision_reason_code, version, created_at, updated_at FROM kyc_applications${scopeClause} ORDER BY created_at DESC LIMIT 200`, scopeValues);
        rows.push(...result.rows.map((row) => mapApplication(row as Record<string, unknown>, "KYC")));
      }
      if (!applicationType || applicationType === "CREDIT") {
        const result = await client.query(`SELECT id, customer_id, status, requested_limit_minor, approved_limit_minor, request_fingerprint, assigned_staff_id, decision_reason_code, version, created_at, updated_at FROM credit_applications${scopeClause} ORDER BY created_at DESC LIMIT 200`, scopeValues);
        rows.push(...result.rows.map((row) => mapApplication(row as Record<string, unknown>, "CREDIT")));
      }
      return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    });
  }
  async findApplication(applicationType: "KYC" | "CREDIT", id: string, scope?: AdminCaseScope) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const table = applicationType === "KYC" ? "kyc_applications" : "credit_applications";
      if (scope) await client.query("SELECT set_config('app.staff_id',$1,true), set_config('app.staff_scope',$2,true)", [scope.staffId, scope.scope]);
      const scopeClause = scope && !scope.canSeeAll ? " AND (assigned_staff_id=$2 OR assigned_staff_id IS NULL)" : "";
      const result = await client.query(`SELECT * FROM ${table} WHERE id=$1${scopeClause}`, scope && !scope.canSeeAll ? [id, scope.staffId] : [id]);
      return result.rows[0] ? mapApplication(result.rows[0] as Record<string, unknown>, applicationType) : null;
    });
  }
  async claimApplication(applicationType: "KYC" | "CREDIT", id: string, staffId: string) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const table = applicationType === "KYC" ? "kyc_applications" : "credit_applications";
      const result = await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
      if (!result.rows[0]) throw notFound("Application not found.");
      const current = result.rows[0] as Record<string, unknown>;
      const status = String(current.status);
      const assigned = current.assigned_staff_id ? String(current.assigned_staff_id) : null;
      if (assigned && assigned !== staffId) throw conflictWithCode("CASE_ALREADY_ASSIGNED", "Case is assigned to another staff member.");
      if (status !== "SUBMITTED" && status !== "UNDER_REVIEW") throw conflictWithCode("CASE_STATUS_CONFLICT", "Case is not available for review.");
      const updated = await client.query(`UPDATE ${table} SET status='UNDER_REVIEW', assigned_staff_id=$2, version=version+1, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, staffId]);
      await client.query("INSERT INTO case_assignments (id, case_type, case_id, staff_id, assigned_by_staff_id) VALUES ($1,$2,$3,$4,$4) ON CONFLICT (case_type, case_id) WHERE status='ACTIVE' DO UPDATE SET staff_id=EXCLUDED.staff_id", [createId("case-assignment"), applicationType, id, staffId]);
      return mapApplication(updated.rows[0] as Record<string, unknown>, applicationType);
    });
  }
  async listTransfers(status?: string) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(`SELECT id, customer_id, source_account_id, reference, amount_minor, fee_minor, currency, status, version, last_error_code, created_at, updated_at FROM transfers ${status ? "WHERE status=$1" : ""} ORDER BY created_at DESC LIMIT 200`, status ? [status] : []);
      return result.rows.map((row) => mapTransfer(row as Record<string, unknown>));
    });
  }
  async findTransfer(id: string) {
    const result = await this.pool.query("SELECT id, customer_id, source_account_id, reference, amount_minor, fee_minor, currency, status, version, last_error_code, created_at, updated_at FROM transfers WHERE id=$1", [id]);
    return result.rows[0] ? mapTransfer(result.rows[0] as Record<string, unknown>) : null;
  }
  async listTransferTimeline(id: string): Promise<AdminTimelineEvent[]> {
    const [audit, transactions, outbox] = await Promise.all([
      this.pool.query("SELECT id, action, actor_staff_id, outcome, reason_code, payload, occurred_at FROM audit_events WHERE target_type='TRANSFER' AND target_id=$1 ORDER BY occurred_at ASC", [id]),
      this.pool.query("SELECT id, direction, amount_minor, fee_minor, status, reference, occurred_at FROM account_transactions WHERE transfer_id=$1 ORDER BY occurred_at ASC", [id]),
      this.pool.query("SELECT id, event_type, status, attempts, last_error_code, trace_id, occurred_at FROM outbox_events WHERE aggregate_id=$1 AND aggregate_type='transfer' ORDER BY occurred_at ASC", [id]),
    ]);
    return [
      ...audit.rows.map((row) => ({ id: String(row.id), eventType: `AUDIT:${String(row.action)}`, occurredAt: new Date(String(row.occurred_at)).toISOString(), actorStaffId: row.actor_staff_id ? String(row.actor_staff_id) : null, outcome: row.outcome ? String(row.outcome) : null, reasonCode: row.reason_code ? String(row.reason_code) : null, metadata: asRecord(row.payload) })),
      ...transactions.rows.map((row) => ({ id: String(row.id), eventType: "ACCOUNT_TRANSACTION", occurredAt: new Date(String(row.occurred_at)).toISOString(), actorStaffId: null, outcome: String(row.status), reasonCode: null, metadata: { direction: String(row.direction), amountMinor: String(row.amount_minor), feeMinor: String(row.fee_minor), reference: String(row.reference) } })),
      ...outbox.rows.map((row) => ({ id: String(row.id), eventType: `OUTBOX:${String(row.event_type)}`, occurredAt: new Date(String(row.occurred_at)).toISOString(), actorStaffId: null, outcome: String(row.status), reasonCode: row.last_error_code ? String(row.last_error_code) : null, metadata: { attempts: asNumber(row.attempts), traceId: row.trace_id ? String(row.trace_id) : null } })),
    ].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }
  async listFraudCases(status?: string) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(`SELECT id, customer_id, account_id, transaction_id, reason, status, severity, assigned_staff_id, resolution_code, version, created_at, updated_at FROM fraud_reports ${status ? "WHERE status=$1" : ""} ORDER BY created_at DESC LIMIT 200`, status ? [status] : []);
      return result.rows.map((row) => mapFraud(row as Record<string, unknown>));
    });
  }
  async findFraudCase(id: string) {
    const result = await this.pool.query("SELECT id, customer_id, account_id, transaction_id, reason, status, severity, assigned_staff_id, resolution_code, version, created_at, updated_at FROM fraud_reports WHERE id=$1", [id]);
    return result.rows[0] ? mapFraud(result.rows[0] as Record<string, unknown>) : null;
  }
  async listFraudCaseTimeline(id: string): Promise<AdminTimelineEvent[]> {
    const [audit, notes, actions, assignments] = await Promise.all([
      this.pool.query("SELECT id, action, actor_staff_id, outcome, reason_code, payload, occurred_at FROM audit_events WHERE target_type='FRAUD_CASE' AND target_id=$1 ORDER BY occurred_at ASC", [id]),
      this.pool.query("SELECT id, author_staff_id, note, created_at FROM case_internal_notes WHERE case_type='FRAUD' AND case_id=$1 ORDER BY created_at ASC", [id]),
      this.pool.query("SELECT id, action_type, resolution_code, status, actor_staff_id, created_at FROM fraud_case_actions WHERE report_id=$1 ORDER BY created_at ASC", [id]),
      this.pool.query("SELECT id, staff_id, assigned_by_staff_id, status, created_at FROM case_assignments WHERE case_type='FRAUD' AND case_id=$1 ORDER BY created_at ASC", [id]),
    ]);
    return [
      ...audit.rows.map((row) => ({ id: String(row.id), eventType: `AUDIT:${String(row.action)}`, occurredAt: new Date(String(row.occurred_at)).toISOString(), actorStaffId: row.actor_staff_id ? String(row.actor_staff_id) : null, outcome: row.outcome ? String(row.outcome) : null, reasonCode: row.reason_code ? String(row.reason_code) : null, metadata: asRecord(row.payload) })),
      ...notes.rows.map((row) => ({ id: String(row.id), eventType: "FRAUD_NOTE_ADDED", occurredAt: new Date(String(row.created_at)).toISOString(), actorStaffId: row.author_staff_id ? String(row.author_staff_id) : null, outcome: "SUCCEEDED", reasonCode: "INVESTIGATION_NOTE", metadata: { note: String(row.note) } })),
      ...actions.rows.map((row) => ({ id: String(row.id), eventType: `FRAUD_ACTION:${String(row.action_type)}`, occurredAt: new Date(String(row.created_at)).toISOString(), actorStaffId: row.actor_staff_id ? String(row.actor_staff_id) : null, outcome: String(row.status), reasonCode: row.resolution_code ? String(row.resolution_code) : null, metadata: {} })),
      ...assignments.rows.map((row) => ({ id: String(row.id), eventType: "FRAUD_CASE_ASSIGNED", occurredAt: new Date(String(row.created_at)).toISOString(), actorStaffId: row.assigned_by_staff_id ? String(row.assigned_by_staff_id) : null, outcome: String(row.status), reasonCode: null, metadata: { assignedStaffId: String(row.staff_id) } })),
    ].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }
  async claimFraudCase(id: string, staffId: string) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const current = await client.query("SELECT id, customer_id, account_id, transaction_id, reason, status, severity, assigned_staff_id, resolution_code, version, created_at, updated_at FROM fraud_reports WHERE id=$1 FOR UPDATE", [id]);
      if (!current.rows[0]) throw notFound("Fraud case not found.");
      const row = current.rows[0] as Record<string, unknown>;
      const assigned = row.assigned_staff_id ? String(row.assigned_staff_id) : null;
      if (assigned && assigned !== staffId) throw conflictWithCode("CASE_ALREADY_ASSIGNED", "Fraud case is assigned to another staff member.");
      if (!['RECEIVED', 'IN_REVIEW'].includes(String(row.status))) throw conflictWithCode("CASE_STATUS_CONFLICT", "Fraud case is not available for review.");
      const updated = await client.query("UPDATE fraud_reports SET status='IN_REVIEW', assigned_staff_id=$2, version=version+1, updated_at=NOW() WHERE id=$1 RETURNING id, customer_id, account_id, transaction_id, reason, status, severity, assigned_staff_id, resolution_code, version, created_at, updated_at", [id, staffId]);
      await client.query("INSERT INTO case_assignments (id, case_type, case_id, staff_id, assigned_by_staff_id) VALUES ($1,'FRAUD',$2,$3,$3) ON CONFLICT (case_type, case_id) WHERE status='ACTIVE' DO UPDATE SET staff_id=EXCLUDED.staff_id", [createId("case-assignment"), id, staffId]);
      return mapFraud(updated.rows[0] as Record<string, unknown>);
    });
  }
  async addFraudNote(id: string, staffId: string, note: string) {
    const safeNote = note.replace(/[<>]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 2000);
    if (!safeNote) throw invalidRequest("Fraud note is required.");
    const exists = await this.pool.query("SELECT 1 FROM fraud_reports WHERE id=$1", [id]);
    if (!exists.rowCount) throw notFound("Fraud case not found.");
    await this.pool.query("INSERT INTO case_internal_notes (id, case_type, case_id, author_staff_id, note) VALUES ($1,'FRAUD',$2,$3,$4)", [createId("fraud-note"), id, staffId, safeNote]);
  }
  async listJobs(status?: string) {
    const result = await this.pool.query(`SELECT id, job_type, status, attempts, last_error_code, lease_expires_at, created_at, updated_at FROM background_jobs ${status ? "WHERE status=$1" : ""} ORDER BY created_at DESC LIMIT 200`, status ? [status] : []);
    return result.rows.map((row) => mapJob(row as Record<string, unknown>));
  }
  async findJob(id: string) {
    const result = await this.pool.query("SELECT id, job_type, status, attempts, last_error_code, lease_expires_at, created_at, updated_at FROM background_jobs WHERE id=$1", [id]);
    return result.rows[0] ? mapJob(result.rows[0] as Record<string, unknown>) : null;
  }
  async findOutboxEvent(id: string) {
    const result = await this.pool.query("SELECT id, event_type, aggregate_id, status, attempts, last_error_code, event_version, aggregate_type, aggregate_version, deduplication_key, payload, occurred_at, updated_at, trace_id FROM outbox_events WHERE id=$1", [id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? { id: String(row.id), eventType: String(row.event_type), aggregateId: String(row.aggregate_id), status: String(row.status ?? "PENDING"), attempts: asNumber(row.attempts), lastErrorCode: row.last_error_code ? String(row.last_error_code) : null, eventVersion: asNumber(row.event_version, 1), aggregateVersion: asNumber(row.aggregate_version, 1), deduplicationKey: row.deduplication_key ? String(row.deduplication_key) : null, requeueable: isCanonicalOutboxRow(row), occurredAt: new Date(String(row.occurred_at)).toISOString(), updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null, traceId: row.trace_id ? String(row.trace_id) : null } : null;
  }
  async reserveBootstrap(reservedBy: string) { await this.unitOfWork.transaction(async ({ client }) => { const result = await client.query("UPDATE admin_bootstrap_state SET reserved_at=NOW(), reserved_by=$1 WHERE singleton=true AND reserved_at IS NULL AND completed_at IS NULL RETURNING singleton", [reservedBy]); if (!result.rowCount) throw conflictWithCode("ADMIN_BOOTSTRAP_ALREADY_COMPLETED", "Admin bootstrap has already been reserved or completed."); }); }
  async abortBootstrap(inviteIds: string[]) {
    await this.unitOfWork.transaction(async ({ client }) => {
      if (inviteIds.length > 0) {
        // Invites are deleted after their hash is no longer usable. The staff
        // row is removed only while still INVITED so the same controlled
        // addresses can retry; an account activated concurrently is disabled
        // instead of being deleted.
        await client.query("DELETE FROM staff_invites WHERE id = ANY($1::uuid[])", [inviteIds]);
        await client.query("DELETE FROM staff_user_roles roles USING staff_users staff WHERE roles.staff_id=staff.id AND staff.id = ANY($1::uuid[]) AND staff.status='INVITED'", [inviteIds]);
        await client.query("DELETE FROM staff_users WHERE id = ANY($1::uuid[]) AND status='INVITED'", [inviteIds]);
        await client.query("UPDATE staff_users SET status='DISABLED', authorization_version=authorization_version+1, updated_at=NOW() WHERE id = ANY($1::uuid[]) AND status <> 'INVITED'", [inviteIds]);
      }
      await client.query("UPDATE admin_bootstrap_state SET reserved_at=NULL, reserved_by=NULL WHERE singleton=true AND completed_at IS NULL");
    });
  }
  async completeBootstrap() { await this.unitOfWork.transaction(async ({ client }) => { await client.query("UPDATE admin_bootstrap_state SET completed_at=NOW() WHERE singleton=true AND reserved_at IS NOT NULL AND completed_at IS NULL"); }); }
  async outboxSummary() { const result = await this.pool.query("SELECT status, COUNT(*)::int AS count FROM outbox_events GROUP BY status"); return Object.fromEntries(result.rows.map((row) => [String(row.status), asNumber(row.count)])); }
  async listOutboxEvents(status?: string) { const result = await this.pool.query(`SELECT id,event_type,aggregate_id,status,attempts,last_error_code,occurred_at,updated_at,trace_id FROM outbox_events ${status ? "WHERE status=$1" : ""} ORDER BY occurred_at DESC LIMIT 200`, status ? [status] : []); return result.rows.map((row) => ({ id: String(row.id), eventType: String(row.event_type), aggregateId: String(row.aggregate_id), status: String(row.status), attempts: asNumber(row.attempts), lastErrorCode: row.last_error_code ? String(row.last_error_code) : null, occurredAt: new Date(String(row.occurred_at)).toISOString(), updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null, traceId: row.trace_id ? String(row.trace_id) : null })); }
}
