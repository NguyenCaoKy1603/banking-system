import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { DatabasePool } from "../../database/pool.js";
import { UnitOfWork } from "../../database/unitOfWork.js";
import { createId } from "../../security.js";
import { conflictWithCode, invalidRequest, notFound } from "../../errors.js";
import { maskAccountNumber, maskEmail, maskPhone, redactAdminMetadata } from "../audit/redaction.js";
import { normalizeExistingAdminRole, type AdminPermission, type AdminRole } from "../authorization/permissionRegistry.js";
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
  requesterName?: string | null;
  requesterEmail?: string | null;
  requesterEmployeeCode?: string | null;
  targetLabel?: string | null;
  targetDisplayName?: string | null;
  targetEmployeeCode?: string | null;
  targetEmail?: string | null;
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
  actorCustomerId?: string | null;
  actorType?: "STAFF" | "CUSTOMER" | "SYSTEM";
  actorName?: string | null;
  actorEmail?: string | null;
  actorEmployeeCode?: string | null;
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
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  fullName?: string | null;
  identityNumber?: string | null;
  address?: string | null;
  documentUri?: string | null;
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
  senderName?: string | null;
  sourceAccountNumber?: string | null;
  destinationOwnerName?: string | null;
  destinationAccountNumber?: string | null;
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

export type AdminAnomalyRecord = {
  id: string;
  customerId: string;
  customerName: string | null;
  accountId: string;
  transferId: string | null;
  transactionId: string | null;
  amountMinor: string;
  currency: string;
  counterpartyName: string | null;
  maskedDestinationAccount: string | null;
  riskLevel: "MEDIUM" | "HIGH" | "CRITICAL";
  riskScore: number;
  ruleCodes: string[];
  summary: string;
  status: "OPEN" | "CONFIRMED_SAFE" | "REPORTED_SUSPICIOUS" | "RESOLVED";
  customerNote: string | null;
  acknowledgedAt: string | null;
  resolutionCode: string | null;
  resolvedAt: string | null;
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

export type AdminControlPolicy = {
  configVersion: number;
  globalKillSwitch: boolean;
  transfersEnabled: boolean;
  maxTransferAmountMinor: string;
  dailyTransferLimitMinor: string;
  transferFeeMinor: string;
  savingsEnabled: boolean;
  maxSavingsAmountMinor: string;
  creditEnabled: boolean;
  creditPaymentsEnabled: boolean;
  cardControlsEnabled: boolean;
  maxCreditPaymentAmountMinor: string;
  updatedAt: string;
};

export type AdminLedgerReconciliation = {
  status: "BALANCED" | "MISMATCH";
  checkedAt: string;
  unbalancedJournalCount: number;
  totalJournalsChecked: number;
  paymentAccountsTotalMinor: string;
  ledgerPaymentAccountsNetMinor: string;
  discrepancyMinor: string;
  unbalancedJournals: Array<{
    journalId: string;
    journalType: string;
    aggregateId: string;
    debitMinor: string;
    creditMinor: string;
  }>;
};

type AdminLedgerJournalSeed = {
  id: string;
  journalType: string;
  aggregateId: string;
  entries: Array<{
    accountRef: string;
    side: "DEBIT" | "CREDIT";
    amountMinor: string;
  }>;
};

type AdminRepositorySeed = {
  staff?: StaffRecord[];
  customers?: CustomerSummary[];
  accounts?: AdminAccount[];
  transactions?: AdminTransaction[];
  applications?: AdminApplication[];
  transfers?: AdminTransfer[];
  anomalies?: AdminAnomalyRecord[];
  fraudCases?: AdminFraudCase[];
  jobs?: AdminJob[];
  outboxEvents?: Array<Record<string, unknown>>;
  controlPolicy?: Partial<AdminControlPolicy>;
  ledgerJournals?: AdminLedgerJournalSeed[];
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

export type CreateOperationsStaffAccountInput = {
  staffId: string;
  employeeCode: string;
  emailNormalized: string;
  displayName: string;
  passwordSalt: string;
  passwordDigest: string;
  creatorStaffId: string;
  environmentScope: "preview" | "production";
  mfaCredential: StaffMfaRecord;
  idempotencyKey: string;
  requestFingerprint: string;
  traceId: string;
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
  createOperationsStaffAccount(input: CreateOperationsStaffAccountInput): Promise<{ staff: StaffRecord; replayed: boolean }>;
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
  listAudit(limit?: number, actorType?: string): Promise<AdminAuditRecord[]>;
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
  listAnomalies(status?: string): Promise<AdminAnomalyRecord[]>;
  resolveAnomaly(input: { id: string; staffId: string; reasonCode: string; comment?: string | null; traceId: string }): Promise<AdminAnomalyRecord>;
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
  getControlPolicy(): Promise<AdminControlPolicy>;
  updateControlPolicy(patch: Record<string, unknown>, actorStaffId: string, traceId: string): Promise<AdminControlPolicy>;
  reconcileLedger(): Promise<AdminLedgerReconciliation>;
}

const DEFAULT_CONTROL_POLICY: AdminControlPolicy = {
  configVersion: 1,
  globalKillSwitch: false,
  transfersEnabled: true,
  maxTransferAmountMinor: "50000000",
  dailyTransferLimitMinor: "50000000",
  transferFeeMinor: "1000",
  savingsEnabled: true,
  maxSavingsAmountMinor: "500000000",
  creditEnabled: true,
  creditPaymentsEnabled: true,
  cardControlsEnabled: true,
  maxCreditPaymentAmountMinor: "100000000",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const POLICY_PATCH_FIELD_ALIASES = new Set([
  "globalKillSwitch",
  "global_kill_switch",
  "transfersEnabled",
  "transfers_enabled",
  "maxTransferAmountMinor",
  "max_transfer_amount_minor",
  "dailyTransferLimitMinor",
  "daily_transfer_limit_minor",
  "transferFeeMinor",
  "transfer_fee_minor",
  "savingsEnabled",
  "savings_enabled",
  "maxSavingsAmountMinor",
  "max_savings_amount_minor",
  "creditEnabled",
  "credit_enabled",
  "creditPaymentsEnabled",
  "credit_payments_enabled",
  "cardControlsEnabled",
  "card_controls_enabled",
  "maxCreditPaymentAmountMinor",
  "max_credit_payment_amount_minor",
  "reasonCode",
  "reason_code",
]);

function parseBooleanPolicyField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidRequest(`${field} must be a boolean.`, { [field]: `${field} must be a boolean.` });
  }
  return value;
}

function parseMinorPolicyField(value: unknown, field: string, allowZero: boolean): string {
  const raw = typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value).trim()
    : "";
  if (!/^\d+$/.test(raw)) {
    throw invalidRequest(`${field} must be an integer minor unit string.`, {
      [field]: `${field} must be an integer minor unit string.`,
    });
  }
  const parsed = BigInt(raw);
  if ((!allowZero && parsed <= 0n) || (allowZero && parsed < 0n)) {
    throw invalidRequest(`${field} is out of range.`, {
      [field]: allowZero ? `${field} must be >= 0.` : `${field} must be > 0.`,
    });
  }
  return parsed.toString();
}

function applyControlPolicyPatch(
  current: AdminControlPolicy,
  patch: Record<string, unknown>,
): { next: AdminControlPolicy; reasonCode: string } {
  const unknownFields = Object.keys(patch).filter((key) => !POLICY_PATCH_FIELD_ALIASES.has(key));
  if (unknownFields.length > 0) {
    throw invalidRequest("Unsupported policy fields.", {
      [unknownFields[0]]: "This policy field cannot be modified.",
    });
  }

  const pick = <T>(camel: string, snake: string, fallback: T, parser: (val: unknown, name: string) => T): T => {
    if (patch[camel] !== undefined) return parser(patch[camel], camel);
    if (patch[snake] !== undefined) return parser(patch[snake], camel);
    return fallback;
  };

  const rawReason = patch.reasonCode ?? patch.reason_code;
  const reasonCode = typeof rawReason === "string" && rawReason.trim()
    ? rawReason.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, 64)
    : "CONTROL_POLICY_UPDATED";

  const next: AdminControlPolicy = {
    configVersion: current.configVersion + 1,
    globalKillSwitch: pick("globalKillSwitch", "global_kill_switch", current.globalKillSwitch, parseBooleanPolicyField),
    transfersEnabled: pick("transfersEnabled", "transfers_enabled", current.transfersEnabled, parseBooleanPolicyField),
    maxTransferAmountMinor: pick("maxTransferAmountMinor", "max_transfer_amount_minor", current.maxTransferAmountMinor, (v, n) => parseMinorPolicyField(v, n, false)),
    dailyTransferLimitMinor: pick("dailyTransferLimitMinor", "daily_transfer_limit_minor", current.dailyTransferLimitMinor, (v, n) => parseMinorPolicyField(v, n, false)),
    transferFeeMinor: pick("transferFeeMinor", "transfer_fee_minor", current.transferFeeMinor, (v, n) => parseMinorPolicyField(v, n, true)),
    savingsEnabled: pick("savingsEnabled", "savings_enabled", current.savingsEnabled, parseBooleanPolicyField),
    maxSavingsAmountMinor: pick("maxSavingsAmountMinor", "max_savings_amount_minor", current.maxSavingsAmountMinor, (v, n) => parseMinorPolicyField(v, n, false)),
    creditEnabled: pick("creditEnabled", "credit_enabled", current.creditEnabled, parseBooleanPolicyField),
    creditPaymentsEnabled: pick("creditPaymentsEnabled", "credit_payments_enabled", current.creditPaymentsEnabled, parseBooleanPolicyField),
    cardControlsEnabled: pick("cardControlsEnabled", "card_controls_enabled", current.cardControlsEnabled, parseBooleanPolicyField),
    maxCreditPaymentAmountMinor: pick("maxCreditPaymentAmountMinor", "max_credit_payment_amount_minor", current.maxCreditPaymentAmountMinor, (v, n) => parseMinorPolicyField(v, n, false)),
    updatedAt: nowIso(),
  };
  return { next, reasonCode };
}

function mapControlPolicyRow(row: Record<string, unknown>): AdminControlPolicy {
  return {
    configVersion: asNumber(row.config_version, 1),
    globalKillSwitch: Boolean(row.global_kill_switch),
    transfersEnabled: Boolean(row.transfers_enabled),
    maxTransferAmountMinor: String(row.max_transfer_amount_minor ?? DEFAULT_CONTROL_POLICY.maxTransferAmountMinor),
    dailyTransferLimitMinor: String(row.daily_transfer_limit_minor ?? DEFAULT_CONTROL_POLICY.dailyTransferLimitMinor),
    transferFeeMinor: String(row.transfer_fee_minor ?? DEFAULT_CONTROL_POLICY.transferFeeMinor),
    savingsEnabled: Boolean(row.savings_enabled),
    maxSavingsAmountMinor: String(row.max_savings_amount_minor ?? DEFAULT_CONTROL_POLICY.maxSavingsAmountMinor),
    creditEnabled: Boolean(row.credit_enabled),
    creditPaymentsEnabled: Boolean(row.credit_payments_enabled),
    cardControlsEnabled: Boolean(row.card_controls_enabled),
    maxCreditPaymentAmountMinor: String(row.max_credit_payment_amount_minor ?? DEFAULT_CONTROL_POLICY.maxCreditPaymentAmountMinor),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : nowIso(),
  };
}

function nowIso(): string { return new Date().toISOString(); }
function normalizedEmail(email: string): string { return email.trim().toLowerCase(); }
function asNumber(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function mapApplication(row: Record<string, unknown>, applicationType: "KYC" | "CREDIT"): AdminApplication {
  const syntheticPayload = row.synthetic_payload && typeof row.synthetic_payload === "object"
    ? row.synthetic_payload as Record<string, unknown>
    : typeof row.synthetic_payload === "string"
      ? (() => { try { return JSON.parse(row.synthetic_payload); } catch { return {}; } })()
      : {};

  return {
    id: String(row.id), applicationType, customerId: String(row.customer_id), status: String(row.status),
    version: asNumber(row.version, 1), requestFingerprint: String(row.request_fingerprint),
    assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
    requestedLimitMinor: row.requested_limit_minor === undefined ? undefined : String(row.requested_limit_minor),
    approvedLimitMinor: row.approved_limit_minor === undefined ? undefined : row.approved_limit_minor === null ? null : String(row.approved_limit_minor),
    applicantLabel: row.applicant_label === undefined ? undefined : String(row.applicant_label),
    customerName: row.customer_name ? String(row.customer_name) : null,
    customerEmail: row.customer_email ? String(row.customer_email) : null,
    customerPhone: row.customer_phone ? String(row.customer_phone) : null,
    decisionReasonCode: row.decision_reason_code ? String(row.decision_reason_code) : null,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
    fullName: syntheticPayload.fullName ? String(syntheticPayload.fullName) : (row.customer_name ? String(row.customer_name) : null),
    identityNumber: syntheticPayload.identityNumber ? String(syntheticPayload.identityNumber) : null,
    address: syntheticPayload.address ? String(syntheticPayload.address) : null,
    documentUri: syntheticPayload.documentUri ? String(syntheticPayload.documentUri) : null,
  };
}
function mapTransfer(row: Record<string, unknown>): AdminTransfer {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    sourceAccountId: String(row.source_account_id),
    reference: String(row.reference),
    amountMinor: String(row.amount_minor),
    feeMinor: String(row.fee_minor),
    currency: String(row.currency),
    status: String(row.status),
    version: asNumber(row.version, 1),
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    senderName: row.sender_name ? String(row.sender_name) : null,
    sourceAccountNumber: row.source_account_number ? maskAccountNumber(String(row.source_account_number)) : null,
    destinationOwnerName: row.dest_owner ? String(row.dest_owner) : null,
    destinationAccountNumber: row.dest_account ? maskAccountNumber(String(row.dest_account)) : null,
  };
}
function mapFraud(row: Record<string, unknown>): AdminFraudCase {
  return { id: String(row.id), customerId: String(row.customer_id), accountId: String(row.account_id), transactionId: String(row.transaction_id), reasonPreview: String(row.reason ?? "").slice(0, 160), status: String(row.status), severity: String(row.severity ?? "MEDIUM"), assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null, resolutionCode: row.resolution_code ? String(row.resolution_code) : null, version: asNumber(row.version, 1), createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString() };
}
function mapAdminAnomaly(row: Record<string, unknown>): AdminAnomalyRecord {
  const ruleCodes = Array.isArray(row.rule_codes) ? row.rule_codes.map((item) => String(item)) : [];
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    customerName: row.customer_name ? String(row.customer_name) : null,
    accountId: String(row.account_id),
    transferId: row.transfer_id ? String(row.transfer_id) : null,
    transactionId: row.transaction_id ? String(row.transaction_id) : null,
    amountMinor: String(row.amount_minor),
    currency: String(row.currency ?? "VND"),
    counterpartyName: row.counterparty_name ? String(row.counterparty_name) : null,
    maskedDestinationAccount: row.masked_destination_account ? maskAccountNumber(String(row.masked_destination_account)) : null,
    riskLevel: String(row.risk_level) as AdminAnomalyRecord["riskLevel"],
    riskScore: asNumber(row.risk_score, 0),
    ruleCodes,
    summary: String(row.summary),
    status: String(row.status) as AdminAnomalyRecord["status"],
    customerNote: row.customer_note ? String(row.customer_note) : null,
    acknowledgedAt: row.acknowledged_at ? new Date(String(row.acknowledged_at)).toISOString() : null,
    resolutionCode: row.resolution_code ? String(row.resolution_code) : null,
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
    version: asNumber(row.version, 1),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
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
    await client.query("INSERT INTO staff_role_change_requests (request_id, staff_id, role_code, operation, environment_scope, reason_code) VALUES ($1,$2,$3,$4,$5,$6)", [requestId, input.targetId, String(payload.roleCode ?? "OPERATIONS"), String(payload.operation ?? "GRANT"), String(payload.environmentScope ?? "preview"), reason]);
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
  subjectCustomerIds?: readonly string[];
  notificationIds?: readonly string[];
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
    subjectCustomerIds: input.subjectCustomerIds,
    notificationIds: input.notificationIds,
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
  private readonly staffAccountCreations = new Map<string, { requestFingerprint: string; staffId: string }>();
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
  private readonly anomalies = new Map<string, AdminAnomalyRecord>();
  private readonly fraudCases = new Map<string, AdminFraudCase>();
  private readonly fraudNotes = new Map<string, AdminTimelineEvent[]>();
  private readonly jobs = new Map<string, AdminJob>();
  private readonly outboxEvents = new Map<string, Record<string, unknown>>();
  private readonly executing = new Set<string>();
  private controlPolicyState: AdminControlPolicy = { ...DEFAULT_CONTROL_POLICY };
  private readonly ledgerJournals: AdminLedgerJournalSeed[] = [];

  constructor(private readonly seed: AdminRepositorySeed = {}) {}

  async initialize(): Promise<void> {
    const roleDefinitions: Array<[AdminRole, string, string]> = [
      ["OPERATIONS", "Vận hành", "Xử lý nghiệp vụ và hỗ trợ khách hàng"], ["ADMIN", "Quản trị", "Quản lý nhân viên, phê duyệt độc lập và kiểm toán"],
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
    for (const row of this.seed.anomalies ?? []) this.anomalies.set(row.id, structuredClone(row));
    for (const row of this.seed.fraudCases ?? []) this.fraudCases.set(row.id, structuredClone(row));
    for (const row of this.seed.jobs ?? []) this.jobs.set(row.id, structuredClone(row));
    for (const row of this.seed.outboxEvents ?? []) {
      const id = String(row.id ?? randomUUID());
      this.outboxEvents.set(id, { ...structuredClone(row), id, requeueable: row.requeueable === true });
    }
    if (this.seed.controlPolicy) {
      this.controlPolicyState = { ...DEFAULT_CONTROL_POLICY, ...structuredClone(this.seed.controlPolicy) };
    }
    for (const journal of this.seed.ledgerJournals ?? []) {
      this.ledgerJournals.push(structuredClone(journal));
    }
  }
  async close(): Promise<void> {}
  listRoles() { return Promise.resolve([...this.roles.values()]); }
  listPermissions() { return Promise.resolve([...this.permissions.values()] as Array<{ code: AdminPermission; description: string }>); }
  findStaffByEmail(email: string) { const row = [...this.staff.values()].find((item) => item.emailNormalized === normalizedEmail(email)); return Promise.resolve(row ? structuredClone(row) : null); }
  findStaffById(id: string) { const row = this.staff.get(id); return Promise.resolve(row ? structuredClone(row) : null); }
  listStaff() { return Promise.resolve([...this.staff.values()].map((row) => structuredClone(row))); }
  async createOperationsStaffAccount(input: CreateOperationsStaffAccountInput): Promise<{ staff: StaffRecord; replayed: boolean }> {
    const requestKey = `${input.creatorStaffId}:${input.idempotencyKey}`;
    const existingRequest = this.staffAccountCreations.get(requestKey);
    if (existingRequest) {
      if (existingRequest.requestFingerprint !== input.requestFingerprint) throw new Error("STAFF_ACCOUNT_IDEMPOTENCY_CONFLICT");
      const existingStaff = this.staff.get(existingRequest.staffId);
      if (!existingStaff) throw new Error("STAFF_ACCOUNT_CREATION_RESULT_MISSING");
      return { staff: structuredClone(existingStaff), replayed: true };
    }
    if ([...this.staff.values()].some((staff) => staff.emailNormalized === input.emailNormalized || staff.employeeCode === input.employeeCode)) {
      throw new Error("STAFF_ACCOUNT_ALREADY_EXISTS");
    }
    const createdAt = nowIso();
    const staff: StaffRecord = {
      id: input.staffId,
      employeeCode: input.employeeCode,
      emailNormalized: input.emailNormalized,
      displayName: input.displayName,
      passwordSalt: input.passwordSalt,
      passwordDigest: input.passwordDigest,
      status: "ACTIVE",
      authorizationVersion: 1,
      passwordChangedAt: createdAt,
      mfaEnrolledAt: createdAt,
      lastLoginAt: null,
      createdAt,
      roles: [{ role: "OPERATIONS", environmentScope: input.environmentScope, expiresAt: null }],
    };
    this.staff.set(staff.id, staff);
    this.mfa.set(staff.id, structuredClone(input.mfaCredential));
    this.staffAccountCreations.set(requestKey, { requestFingerprint: input.requestFingerprint, staffId: staff.id });
    await this.appendAudit({
      id: randomUUID(),
      actorStaffId: input.creatorStaffId,
      action: "STAFF_OPERATIONS_ACCOUNT_CREATED",
      targetType: "STAFF",
      targetId: staff.id,
      outcome: "SUCCEEDED",
      reasonCode: "OPERATIONS_ACCOUNT_CREATED",
      requestId: null,
      traceId: input.traceId,
      correlationId: null,
      beforeVersion: null,
      afterVersion: staff.authorizationVersion,
      metadata: { role: "OPERATIONS", environmentScope: input.environmentScope },
      occurredAt: createdAt,
    });
    return { staff: structuredClone(staff), replayed: false };
  }
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
      if (!target) return finish("FAILED", undefined, `${action.targetType}_NOT_FOUND`);
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
      if (action.actionType === "STAFF_ROLE_CHANGE") {
        const staff = this.staff.get(action.targetId)!;
        const operation = String(action.payload.operation ?? "GRANT").toUpperCase();
        const role = normalizeExistingAdminRole(String(action.payload.roleCode ?? "OPERATIONS"));
        if (!role) return finish("FAILED", undefined, "STAFF_ROLE_INVALID");
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
  listAudit(limit = 100, actorType?: string) {
    const filtered = actorType ? this.audit.filter((row) => row.actorType === actorType) : this.audit;
    return Promise.resolve(filtered.slice(-Math.min(limit, 1000)).reverse().map((row) => structuredClone(row)));
  }
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
  listAnomalies(status?: string) {
    return Promise.resolve(
      [...this.anomalies.values()]
        .filter((row) => !status || row.status === status)
        .sort((left, right) => right.riskScore - left.riskScore || Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map((row) => structuredClone(row)),
    );
  }
  async resolveAnomaly(input: { id: string; staffId: string; reasonCode: string; comment?: string | null; traceId: string }): Promise<AdminAnomalyRecord> {
    const row = this.anomalies.get(input.id);
    if (!row) throw notFound("Transaction anomaly not found.");
    const reasonCode = input.reasonCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,64}$/.test(reasonCode)) throw invalidRequest("A normalized reason code is required.");
    const now = nowIso();
    row.status = "RESOLVED";
    row.resolutionCode = reasonCode;
    row.resolvedAt = now;
    row.version += 1;
    row.updatedAt = now;
    await this.appendAudit({
      id: randomUUID(),
      actorStaffId: input.staffId,
      action: "ADMIN_ANOMALY_RESOLVED",
      targetType: "TRANSACTION_ANOMALY",
      targetId: row.id,
      outcome: "SUCCEEDED",
      reasonCode,
      requestId: null,
      traceId: input.traceId,
      correlationId: null,
      beforeVersion: row.version - 1,
      afterVersion: row.version,
      metadata: { riskLevel: row.riskLevel, riskScore: row.riskScore, comment: input.comment ?? null },
      occurredAt: now,
    });
    return structuredClone(row);
  }
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
  getControlPolicy() {
    return Promise.resolve(structuredClone(this.controlPolicyState));
  }
  async updateControlPolicy(patch: Record<string, unknown>, actorStaffId: string, traceId: string): Promise<AdminControlPolicy> {
    const before = structuredClone(this.controlPolicyState);
    const { next, reasonCode } = applyControlPolicyPatch(before, patch);
    this.controlPolicyState = structuredClone(next);
    await this.appendAudit({
      id: randomUUID(),
      actorStaffId,
      action: "CONTROL_POLICY_UPDATED",
      targetType: "CONTROL_POLICY",
      targetId: "singleton",
      outcome: "SUCCEEDED",
      reasonCode,
      requestId: null,
      traceId,
      correlationId: null,
      beforeVersion: before.configVersion,
      afterVersion: next.configVersion,
      metadata: { before, after: next },
      occurredAt: next.updatedAt,
    });
    return structuredClone(next);
  }
  reconcileLedger(): Promise<AdminLedgerReconciliation> {
    let paymentAccountsTotal = 0n;
    for (const account of this.accounts.values()) {
      paymentAccountsTotal += BigInt(account.currentMinor);
    }

    const unbalancedJournals: AdminLedgerReconciliation["unbalancedJournals"] = [];
    let ledgerPaymentNet = 0n;
    if (this.ledgerJournals.length > 0) {
      for (const journal of this.ledgerJournals) {
        let debit = 0n;
        let credit = 0n;
        for (const entry of journal.entries) {
          const amount = BigInt(entry.amountMinor);
          if (entry.side === "DEBIT") {
            debit += amount;
            if (entry.accountRef.startsWith("payment-account:")) {
              ledgerPaymentNet -= amount;
            }
          } else {
            credit += amount;
            if (entry.accountRef.startsWith("payment-account:")) {
              ledgerPaymentNet += amount;
            }
          }
        }
        if (debit !== credit) {
          unbalancedJournals.push({
            journalId: journal.id,
            journalType: journal.journalType,
            aggregateId: journal.aggregateId,
            debitMinor: debit.toString(),
            creditMinor: credit.toString(),
          });
        }
      }
    } else {
      ledgerPaymentNet = paymentAccountsTotal;
    }

    const discrepancy = paymentAccountsTotal - ledgerPaymentNet;
    const status = unbalancedJournals.length === 0 && discrepancy === 0n ? "BALANCED" : "MISMATCH";
    return Promise.resolve({
      status,
      checkedAt: nowIso(),
      unbalancedJournalCount: unbalancedJournals.length,
      totalJournalsChecked: this.ledgerJournals.length,
      paymentAccountsTotalMinor: paymentAccountsTotal.toString(),
      ledgerPaymentAccountsNetMinor: ledgerPaymentNet.toString(),
      discrepancyMinor: discrepancy.toString(),
      unbalancedJournals,
    });
  }
}

function mapStaff(row: Record<string, unknown>, roles: StaffRecord["roles"] = []): StaffRecord {
  return { id: String(row.id), employeeCode: String(row.employee_code), emailNormalized: String(row.email_normalized), displayName: String(row.display_name), passwordSalt: row.password_salt ? String(row.password_salt) : null, passwordDigest: row.password_digest ? String(row.password_digest) : null, status: String(row.status) as StaffStatus, authorizationVersion: asNumber(row.authorization_version, 1), passwordChangedAt: row.password_changed_at ? new Date(String(row.password_changed_at)).toISOString() : null, mfaEnrolledAt: row.mfa_enrolled_at ? new Date(String(row.mfa_enrolled_at)).toISOString() : null, lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)).toISOString() : null, createdAt: new Date(String(row.created_at)).toISOString(), roles };
}
function mapAction(row: Record<string, unknown>): AdminActionRecord {
  return {
    id: String(row.id),
    actionType: String(row.action_type),
    requesterStaffId: String(row.requester_staff_id),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    requestFingerprint: String(row.request_fingerprint),
    policyVersion: String(row.policy_version),
    status: String(row.status) as ActionStatus,
    idempotencyKey: String(row.idempotency_key),
    expectedTargetVersion: row.expected_target_version === null ? null : asNumber(row.expected_target_version),
    expectedTargetStatus: row.expected_target_status ? String(row.expected_target_status) : null,
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    payload: asRecord(row.payload),
    resultResourceId: row.result_resource_id ? String(row.result_resource_id) : null,
    failureCode: row.failure_code ? String(row.failure_code) : null,
    version: asNumber(row.version, 1),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    requesterName: row.requester_name ? String(row.requester_name) : null,
    requesterEmail: row.requester_email ? String(row.requester_email) : null,
    requesterEmployeeCode: row.requester_employee_code ? String(row.requester_employee_code) : null,
    targetLabel: row.target_label ? String(row.target_label) : null,
    targetDisplayName: row.target_display_name ? String(row.target_display_name) : null,
    targetEmployeeCode: row.target_employee_code ? String(row.target_employee_code) : null,
    targetEmail: row.target_email ? String(row.target_email) : null,
  };
}
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
  async createOperationsStaffAccount(input: CreateOperationsStaffAccountInput): Promise<{ staff: StaffRecord; replayed: boolean }> {
    try {
      return await this.unitOfWork.transaction(async ({ client }) => {
        const lockKey = `${input.creatorStaffId}:${input.idempotencyKey}`;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
        const existingRequest = await client.query(
          "SELECT request_fingerprint, staff_id FROM admin_staff_account_creation_requests WHERE requester_staff_id = $1 AND idempotency_key = $2 FOR UPDATE",
          [input.creatorStaffId, input.idempotencyKey],
        );
        if (existingRequest.rows[0]) {
          if (String(existingRequest.rows[0].request_fingerprint) !== input.requestFingerprint) throw new Error("STAFF_ACCOUNT_IDEMPOTENCY_CONFLICT");
          const existingStaff = await client.query("SELECT * FROM staff_users WHERE id = $1", [existingRequest.rows[0].staff_id]);
          if (!existingStaff.rows[0]) throw new Error("STAFF_ACCOUNT_CREATION_RESULT_MISSING");
          return { staff: await this.staffWithRoles(client, existingStaff.rows[0] as Record<string, unknown>), replayed: true };
        }
        const duplicate = await client.query(
          "SELECT id FROM staff_users WHERE email_normalized = lower($1) OR employee_code = $2 LIMIT 1 FOR UPDATE",
          [input.emailNormalized, input.employeeCode],
        );
        if (duplicate.rows[0]) throw new Error("STAFF_ACCOUNT_ALREADY_EXISTS");

        const insertedStaff = await client.query(
          "INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status, authorization_version, password_changed_at, mfa_enrolled_at, created_by_staff_id) VALUES ($1,$2,lower($3),$4,$5,$6,'ACTIVE',1,NOW(),NOW(),$7) RETURNING *",
          [input.staffId, input.employeeCode, input.emailNormalized, input.displayName, input.passwordSalt, input.passwordDigest, input.creatorStaffId],
        );
        await client.query(
          "INSERT INTO staff_user_roles (staff_id, role_code, environment_scope, granted_by_staff_id) VALUES ($1,'OPERATIONS',$2,$3)",
          [input.staffId, input.environmentScope, input.creatorStaffId],
        );
        const credential = input.mfaCredential;
        await client.query(
          "INSERT INTO staff_mfa_credentials (id, staff_id, secret_ciphertext, encryption_key_id, secret_cipher_version, secret_aad_version, secret_encryption_algorithm, secret_encrypted_data_key, last_accepted_time_step) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [credential.id, credential.staffId, credential.secretCiphertext, credential.encryptionKeyId, credential.secretCipherVersion ?? "v2", credential.secretAadVersion ?? "aad-v1", credential.secretEncryptionAlgorithm ?? "AES-256-GCM-ENVELOPE", credential.secretEncryptedDataKey ?? null, credential.lastAcceptedTimeStep],
        );
        await client.query(
          "INSERT INTO admin_staff_account_creation_requests (requester_staff_id, idempotency_key, request_fingerprint, staff_id) VALUES ($1,$2,$3,$4)",
          [input.creatorStaffId, input.idempotencyKey, input.requestFingerprint, input.staffId],
        );
        await client.query(
          "INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,correlation_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_AUDIT_EVENT','STAFF',$2,'STAFF_OPERATIONS_ACCOUNT_CREATED','STAFF',$3,'SUCCEEDED','OPERATIONS_ACCOUNT_CREATED',NULL,$4,NULL,NULL,1,$5,NOW())",
          [randomUUID(), input.creatorStaffId, input.staffId, input.traceId, JSON.stringify({ role: "OPERATIONS", environmentScope: input.environmentScope })],
        );
        return { staff: await this.staffWithRoles(client, insertedStaff.rows[0] as Record<string, unknown>), replayed: false };
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new Error("STAFF_ACCOUNT_ALREADY_EXISTS");
      throw error;
    }
  }
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
  async findAction(id: string) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(`
        SELECT a.*,
               req.display_name AS requester_name,
               req.email_normalized AS requester_email,
               req.employee_code AS requester_employee_code,
               CASE
                 WHEN a.target_type = 'STAFF' THEN 'Nhân viên: ' || tgt_staff.display_name || ' (' || tgt_staff.employee_code || ' · ' || tgt_staff.email_normalized || ')'
                 WHEN a.target_type = 'TRANSFER' THEN 'Chuyển tiền: ' || COALESCE(tr_sender.full_name, 'Khách hàng') || ' ➔ ' || COALESCE(tr_dest.full_name, 'Thụ hưởng') || ' (' || to_char(tr.amount_minor, 'FM999,999,999,999') || ' VND) · ' || COALESCE(a.payload->>'operation', 'Xử lý')
                 WHEN a.target_type = 'KYC_APPLICATION' THEN 'Hồ sơ eKYC: ' || COALESCE(kyc_c.full_name, a.target_id) || ' (Mã: #' || substring(a.target_id from 1 for 8) || ')'
                 WHEN a.target_type = 'CREDIT_APPLICATION' THEN 'Hồ sơ Tín dụng: ' || COALESCE(cr_c.full_name, a.target_id) || ' (Mã: #' || substring(a.target_id from 1 for 8) || ')'
                 WHEN a.target_type = 'ACCOUNT' THEN 'Tài khoản thanh toán: #' || substring(a.target_id from 1 for 8)
                 WHEN a.target_type = 'CUSTOMER' THEN 'Khách hàng: #' || substring(a.target_id from 1 for 8)
                 ELSE a.target_type || ' #' || substring(a.target_id from 1 for 8)
               END AS target_label,
               tgt_staff.display_name AS target_staff_name,
               tgt_staff.employee_code AS target_employee_code,
               tgt_staff.email_normalized AS target_email,
               COALESCE(tr_sender.full_name, kyc_c.full_name, cr_c.full_name, tgt_staff.display_name) AS target_display_name
        FROM admin_action_requests a
        LEFT JOIN staff_users req ON a.requester_staff_id = req.id
        LEFT JOIN staff_users tgt_staff ON a.target_type = 'STAFF' AND a.target_id::text = tgt_staff.id::text
        LEFT JOIN transfers tr ON a.target_type = 'TRANSFER' AND a.target_id::text = tr.id::text
        LEFT JOIN customers tr_sender ON tr.customer_id = tr_sender.id
        LEFT JOIN customers tr_dest ON tr.destination_owner_id = tr_dest.id
        LEFT JOIN kyc_applications kyc_app ON a.target_type = 'KYC_APPLICATION' AND a.target_id::text = kyc_app.id::text
        LEFT JOIN customers kyc_c ON kyc_app.customer_id = kyc_c.id
        LEFT JOIN credit_applications cr_app ON a.target_type = 'CREDIT_APPLICATION' AND a.target_id::text = cr_app.id::text
        LEFT JOIN customers cr_c ON cr_app.customer_id = cr_c.id
        WHERE a.id = $1
      `, [id]);
      return result.rows[0] ? mapAction(result.rows[0] as Record<string, unknown>) : null;
    });
  }
  async listActions(status?: ActionStatus, scope?: AdminCaseScope) {
    return this.unitOfWork.transaction(async ({ client }) => {
      if (scope) await client.query("SELECT set_config('app.staff_id',$1,true), set_config('app.staff_scope',$2,true)", [scope.staffId, scope.scope]);
      const predicates: string[] = [];
      const values: unknown[] = [];
      if (status) {
        values.push(status);
        predicates.push(`a.status = $${values.length}`);
      }
      if (scope && !scope.canSeeAll) {
        values.push(scope.staffId);
        predicates.push(`a.requester_staff_id = $${values.length}`);
      }
      const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
      const result = await client.query(`
        SELECT a.*,
               req.display_name AS requester_name,
               req.email_normalized AS requester_email,
               req.employee_code AS requester_employee_code,
               CASE
                 WHEN a.target_type = 'STAFF' THEN 'Nhân viên: ' || tgt_staff.display_name || ' (' || tgt_staff.employee_code || ' · ' || tgt_staff.email_normalized || ')'
                 WHEN a.target_type = 'TRANSFER' THEN 'Chuyển tiền: ' || COALESCE(tr_sender.full_name, 'Khách hàng') || ' ➔ ' || COALESCE(tr_dest.full_name, 'Thụ hưởng') || ' (' || to_char(tr.amount_minor, 'FM999,999,999,999') || ' VND) · ' || COALESCE(a.payload->>'operation', 'Xử lý')
                 WHEN a.target_type = 'KYC_APPLICATION' THEN 'Hồ sơ eKYC: ' || COALESCE(kyc_c.full_name, a.target_id) || ' (Mã: #' || substring(a.target_id from 1 for 8) || ')'
                 WHEN a.target_type = 'CREDIT_APPLICATION' THEN 'Hồ sơ Tín dụng: ' || COALESCE(cr_c.full_name, a.target_id) || ' (Mã: #' || substring(a.target_id from 1 for 8) || ')'
                 WHEN a.target_type = 'ACCOUNT' THEN 'Tài khoản thanh toán: #' || substring(a.target_id from 1 for 8)
                 WHEN a.target_type = 'CUSTOMER' THEN 'Khách hàng: #' || substring(a.target_id from 1 for 8)
                 ELSE a.target_type || ' #' || substring(a.target_id from 1 for 8)
               END AS target_label,
               tgt_staff.display_name AS target_staff_name,
               tgt_staff.employee_code AS target_employee_code,
               tgt_staff.email_normalized AS target_email,
               COALESCE(tr_sender.full_name, kyc_c.full_name, cr_c.full_name, tgt_staff.display_name) AS target_display_name
        FROM admin_action_requests a
        LEFT JOIN staff_users req ON a.requester_staff_id = req.id
        LEFT JOIN staff_users tgt_staff ON a.target_type = 'STAFF' AND a.target_id::text = tgt_staff.id::text
        LEFT JOIN transfers tr ON a.target_type = 'TRANSFER' AND a.target_id::text = tr.id::text
        LEFT JOIN customers tr_sender ON tr.customer_id = tr_sender.id
        LEFT JOIN customers tr_dest ON tr.destination_owner_id = tr_dest.id
        LEFT JOIN kyc_applications kyc_app ON a.target_type = 'KYC_APPLICATION' AND a.target_id::text = kyc_app.id::text
        LEFT JOIN customers kyc_c ON kyc_app.customer_id = kyc_c.id
        LEFT JOIN credit_applications cr_app ON a.target_type = 'CREDIT_APPLICATION' AND a.target_id::text = cr_app.id::text
        LEFT JOIN customers cr_c ON cr_app.customer_id = cr_c.id
        ${where}
        ORDER BY a.created_at DESC LIMIT 500
      `, values);
      return result.rows.map((row) => mapAction(row as Record<string, unknown>));
    });
  }
  async decideAction(input: { requestId: string; reviewerStaffId: string; decision: "APPROVED" | "REJECTED"; approvedFingerprint: string; reasonCode: string; comment?: string | null; mfaVerifiedAt: string }) { return this.unitOfWork.transaction(async ({ client }) => {
    // Serialize all approval decisions on the action row before checking the
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
        if (applicationType === "KYC") {
          await client.query("INSERT INTO kyc_reviews (id, application_id, reviewer_staff_id, recommendation, application_version, request_fingerprint, reason_code) VALUES ($1,$2,$3,$4,$5,$6,$7)", [createId("kyc-review"), action.targetId, input.approverStaffId, decision === "NEEDS_MORE_INFO" ? "MORE_INFO_REQUIRED" : decision, before, action.requestFingerprint, String(action.payload.reasonCode ?? "ADMIN_DECISION")]);
          const customerId = String(target.rows[0].customer_id);
          const notificationId = createId("kyc-notification");
          const message = decision === "APPROVED"
            ? "Hồ sơ định danh đã được phê duyệt."
            : decision === "REJECTED"
              ? "Hồ sơ định danh chưa được phê duyệt."
              : "Hồ sơ định danh cần bổ sung thông tin.";
          await client.query(
            "INSERT INTO notifications (id, customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at) VALUES ($1,$2,'SECURITY','Cập nhật hồ sơ định danh',$3,$4,NULL,false,NOW())",
            [notificationId, customerId, message, action.targetId],
          );
          await insertAdminOutboxEvent(client, {
            eventType: "SECURITY_KYC_STATUS_CHANGED",
            aggregateType: "kyc-application",
            aggregateId: action.targetId,
            aggregateVersion: after,
            deduplicationKey: `kyc-status:${action.targetId}:${after}`,
            traceId: input.traceId,
            subjectCustomerIds: [customerId],
            notificationIds: [notificationId],
            payload: { applicationId: action.targetId, status: decision },
          });
        }
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
        const roleCode = normalizeExistingAdminRole(String(action.payload.roleCode ?? "OPERATIONS"));
        const scope = String(action.payload.environmentScope ?? "preview");
        if (!roleCode) {
          await client.query("UPDATE admin_action_execution_attempts SET outcome='FAILED', error_code='STAFF_ROLE_INVALID', finished_at=NOW() WHERE id=$1", [attempt]);
          await client.query("UPDATE admin_action_requests SET status='FAILED', failure_code='STAFF_ROLE_INVALID', updated_at=NOW() WHERE id=$1", [action.id]);
          return { status: "FAILED", failureCode: "STAFF_ROLE_INVALID" };
        }
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
  async listAudit(limit = 100, actorType?: string) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const params: unknown[] = [];
      let whereClause = "";
      if (actorType && ["STAFF", "CUSTOMER", "SYSTEM"].includes(actorType)) {
        params.push(actorType);
        whereClause = `WHERE a.actor_type = $${params.length}`;
      }
      params.push(Math.min(limit, 1000));
      const limitParam = `$${params.length}`;
      const query = `
        SELECT a.id, a.actor_type, a.actor_staff_id, a.actor_customer_id,
               a.action, a.event_type, a.target_type, a.target_id,
               a.outcome, a.reason_code, a.request_id, a.trace_id, a.correlation_id,
               a.before_version, a.after_version, a.payload, a.occurred_at,
               COALESCE(s.display_name, c.full_name, CASE WHEN a.actor_type = 'SYSTEM' THEN 'Hệ thống' ELSE NULL END) AS actor_name,
               COALESCE(s.email_normalized, c.email, NULL) AS actor_email,
               s.employee_code AS actor_employee_code
        FROM audit_events a
        LEFT JOIN staff_users s ON a.actor_staff_id = s.id
        LEFT JOIN customers c ON a.actor_customer_id = c.id
        ${whereClause}
        ORDER BY a.occurred_at DESC
        LIMIT ${limitParam}
      `;
      const result = await client.query(query, params);
      return result.rows.map((row) => ({
        id: String(row.id),
        actorStaffId: row.actor_staff_id ? String(row.actor_staff_id) : null,
        actorCustomerId: row.actor_customer_id ? String(row.actor_customer_id) : null,
        actorType: (row.actor_type as "STAFF" | "CUSTOMER" | "SYSTEM") || "STAFF",
        actorName: row.actor_name ? String(row.actor_name) : null,
        actorEmail: row.actor_email ? String(row.actor_email) : null,
        actorEmployeeCode: row.actor_employee_code ? String(row.actor_employee_code) : null,
        action: String(row.action || row.event_type || "UNKNOWN_ACTION"),
        targetType: row.target_type ? String(row.target_type) : null,
        targetId: row.target_id ? String(row.target_id) : null,
        outcome: String(row.outcome ?? "UNKNOWN"),
        reasonCode: row.reason_code ? String(row.reason_code) : null,
        requestId: row.request_id ? String(row.request_id) : null,
        traceId: row.trace_id ? String(row.trace_id) : null,
        correlationId: row.correlation_id ? String(row.correlation_id) : null,
        beforeVersion: row.before_version === null ? null : asNumber(row.before_version),
        afterVersion: row.after_version === null ? null : asNumber(row.after_version),
        metadata: redactAdminMetadata(asRecord(row.payload)) as Record<string, unknown>,
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
      }));
    });
  }
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
      const scopeClause = scoped ? " WHERE a.assigned_staff_id=$1 OR a.assigned_staff_id IS NULL" : "";
      const scopeValues = scoped ? [scope!.staffId] : [];
      if (!applicationType || applicationType === "KYC") {
        const result = await client.query(`SELECT a.id, a.customer_id, a.status, a.applicant_label, a.synthetic_payload, a.request_fingerprint, a.assigned_staff_id, a.decision_reason_code, a.version, a.created_at, a.updated_at, c.full_name AS customer_name, c.email AS customer_email, c.phone_number AS customer_phone FROM kyc_applications a LEFT JOIN customers c ON a.customer_id = c.id${scopeClause} ORDER BY a.created_at DESC LIMIT 200`, scopeValues);
        rows.push(...result.rows.map((row) => mapApplication(row as Record<string, unknown>, "KYC")));
      }
      if (!applicationType || applicationType === "CREDIT") {
        const result = await client.query(`SELECT a.id, a.customer_id, a.status, a.requested_limit_minor, a.approved_limit_minor, a.request_fingerprint, a.assigned_staff_id, a.decision_reason_code, a.version, a.created_at, a.updated_at, c.full_name AS customer_name, c.email AS customer_email, c.phone_number AS customer_phone FROM credit_applications a LEFT JOIN customers c ON a.customer_id = c.id${scopeClause} ORDER BY a.created_at DESC LIMIT 200`, scopeValues);
        rows.push(...result.rows.map((row) => mapApplication(row as Record<string, unknown>, "CREDIT")));
      }
      return rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    });
  }
  async findApplication(applicationType: "KYC" | "CREDIT", id: string, scope?: AdminCaseScope) {
    return this.unitOfWork.transaction(async ({ client }) => {
      const table = applicationType === "KYC" ? "kyc_applications" : "credit_applications";
      if (scope) await client.query("SELECT set_config('app.staff_id',$1,true), set_config('app.staff_scope',$2,true)", [scope.staffId, scope.scope]);
      const scopeClause = scope && !scope.canSeeAll ? " AND (a.assigned_staff_id=$2 OR a.assigned_staff_id IS NULL)" : "";
      const result = await client.query(`SELECT a.*, c.full_name AS customer_name, c.email AS customer_email, c.phone_number AS customer_phone FROM ${table} a LEFT JOIN customers c ON a.customer_id = c.id WHERE a.id=$1${scopeClause}`, scope && !scope.canSeeAll ? [id, scope.staffId] : [id]);
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
      const result = await client.query(
        `SELECT
           t.id, t.customer_id, t.source_account_id, t.reference, t.amount_minor, t.fee_minor,
           t.currency, t.status, t.version, t.last_error_code, t.created_at, t.updated_at,
           c.full_name AS sender_name,
           a.masked_number AS source_account_number,
           dc.full_name AS dest_owner,
           da.masked_number AS dest_account
         FROM transfers t
         LEFT JOIN customers c ON t.customer_id = c.id
         LEFT JOIN payment_accounts a ON t.source_account_id = a.id
         LEFT JOIN customers dc ON t.destination_owner_id = dc.id
         LEFT JOIN payment_accounts da ON t.destination_account_id = da.id
         ${status ? "WHERE t.status=$1" : ""}
         ORDER BY t.created_at DESC LIMIT 200`,
        status ? [status] : []
      );
      return result.rows.map((row) => mapTransfer(row as Record<string, unknown>));
    });
  }
  async findTransfer(id: string) {
    const result = await this.pool.query(
      `SELECT
         t.id, t.customer_id, t.source_account_id, t.reference, t.amount_minor, t.fee_minor,
         t.currency, t.status, t.version, t.last_error_code, t.created_at, t.updated_at,
         c.full_name AS sender_name,
         a.masked_number AS source_account_number,
         dc.full_name AS dest_owner,
         da.masked_number AS dest_account
       FROM transfers t
       LEFT JOIN customers c ON t.customer_id = c.id
       LEFT JOIN payment_accounts a ON t.source_account_id = a.id
       LEFT JOIN customers dc ON t.destination_owner_id = dc.id
       LEFT JOIN payment_accounts da ON t.destination_account_id = da.id
       WHERE t.id=$1`,
      [id]
    );
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
  async listAnomalies(status?: string): Promise<AdminAnomalyRecord[]> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const normalizedStatus = status?.trim().toUpperCase() || null;
      const result = await client.query(
        `SELECT a.*, c.full_name AS customer_name
         FROM transaction_anomalies a
         LEFT JOIN customers c ON a.customer_id = c.id
         WHERE ($1::text IS NULL OR a.status = $1)
         ORDER BY a.risk_score DESC, a.created_at DESC
         LIMIT 200`,
        [normalizedStatus],
      );
      return result.rows.map((row) => mapAdminAnomaly(row as Record<string, unknown>));
    });
  }
  async resolveAnomaly(input: { id: string; staffId: string; reasonCode: string; comment?: string | null; traceId: string }): Promise<AdminAnomalyRecord> {
    const reasonCode = input.reasonCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,64}$/.test(reasonCode)) {
      throw invalidRequest("A normalized reason code is required.", { reasonCode: "reasonCode must be 3-64 uppercase characters." });
    }
    const safeComment = typeof input.comment === "string"
      ? input.comment.replace(/[<>]/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 500) || null
      : null;
    return this.unitOfWork.transaction(async ({ client }) => {
      const current = await client.query(
        `SELECT a.*, c.full_name AS customer_name
         FROM transaction_anomalies a
         LEFT JOIN customers c ON a.customer_id = c.id
         WHERE a.id = $1 FOR UPDATE OF a`,
        [input.id],
      );
      if (!current.rows[0]) throw notFound("Transaction anomaly not found.");
      const before = asNumber(current.rows[0].version, 1);
      const updated = await client.query(
        `UPDATE transaction_anomalies
            SET status = 'RESOLVED',
                resolved_by_staff_id = $2,
                resolution_code = $3,
                resolved_at = NOW(),
                version = version + 1,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [input.id, input.staffId, reasonCode],
      );
      const updatedRow = updated.rows[0] as Record<string, unknown>;
      updatedRow.customer_name = current.rows[0].customer_name;
      const mapped = mapAdminAnomaly(updatedRow);
      await client.query(
        "INSERT INTO audit_events (id,event_type,actor_type,actor_staff_id,action,target_type,target_id,outcome,reason_code,request_id,trace_id,before_version,after_version,payload,occurred_at) VALUES ($1,'ADMIN_ANOMALY_RESOLVED','STAFF',$2,'ANOMALY_RESOLVE','TRANSACTION_ANOMALY',$3,'SUCCEEDED',$4,NULL,$5,$6,$7,$8,NOW())",
        [
          randomUUID(),
          input.staffId,
          mapped.id,
          reasonCode,
          input.traceId,
          before,
          mapped.version,
          JSON.stringify(redactAdminMetadata({ riskLevel: mapped.riskLevel, riskScore: mapped.riskScore, comment: safeComment })),
        ],
      );
      return mapped;
    });
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
  async getControlPolicy(): Promise<AdminControlPolicy> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query("SELECT * FROM control_policy WHERE singleton = true");
      if (!result.rows[0]) {
        throw notFound("Control policy is not initialized.");
      }
      return mapControlPolicyRow(result.rows[0] as Record<string, unknown>);
    });
  }
  async updateControlPolicy(patch: Record<string, unknown>, actorStaffId: string, traceId: string): Promise<AdminControlPolicy> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const locked = await client.query("SELECT * FROM control_policy WHERE singleton = true FOR UPDATE");
      if (!locked.rows[0]) {
        throw notFound("Control policy is not initialized.");
      }
      const before = mapControlPolicyRow(locked.rows[0] as Record<string, unknown>);
      const { next, reasonCode } = applyControlPolicyPatch(before, patch);
      const updated = await client.query(
        `UPDATE control_policy
            SET global_kill_switch = $1,
                transfers_enabled = $2,
                max_transfer_amount_minor = $3,
                daily_transfer_limit_minor = $4,
                transfer_fee_minor = $5,
                savings_enabled = $6,
                max_savings_amount_minor = $7,
                credit_enabled = $8,
                credit_payments_enabled = $9,
                card_controls_enabled = $10,
                max_credit_payment_amount_minor = $11,
                config_version = config_version + 1,
                updated_at = NOW()
          WHERE singleton = true
          RETURNING *`,
        [
          next.globalKillSwitch,
          next.transfersEnabled,
          next.maxTransferAmountMinor,
          next.dailyTransferLimitMinor,
          next.transferFeeMinor,
          next.savingsEnabled,
          next.maxSavingsAmountMinor,
          next.creditEnabled,
          next.creditPaymentsEnabled,
          next.cardControlsEnabled,
          next.maxCreditPaymentAmountMinor,
        ],
      );
      const after = mapControlPolicyRow(updated.rows[0] as Record<string, unknown>);
      await client.query(
        `INSERT INTO audit_events
          (id, event_type, actor_type, actor_staff_id, action, target_type, target_id,
           outcome, reason_code, request_id, trace_id, before_version, after_version, payload, occurred_at)
         VALUES ($1, 'CONTROL_POLICY_UPDATED', 'STAFF', $2, 'CONTROL_POLICY_UPDATED', 'CONTROL_POLICY', 'singleton',
                 'SUCCEEDED', $3, NULL, $4, $5, $6, $7, NOW())`,
        [
          randomUUID(),
          actorStaffId,
          reasonCode,
          traceId,
          before.configVersion,
          after.configVersion,
          JSON.stringify(redactAdminMetadata({ before, after })),
        ],
      );
      return after;
    });
  }
  async reconcileLedger(): Promise<AdminLedgerReconciliation> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const unbalancedResult = await client.query(
        `SELECT j.id AS journal_id,
                j.journal_type,
                j.aggregate_id,
                COALESCE(SUM(CASE WHEN e.side = 'DEBIT' THEN e.amount_minor ELSE 0 END), 0)::text AS debit_minor,
                COALESCE(SUM(CASE WHEN e.side = 'CREDIT' THEN e.amount_minor ELSE 0 END), 0)::text AS credit_minor
           FROM ledger_journals j
           LEFT JOIN ledger_entries e ON e.journal_id = j.id
          GROUP BY j.id, j.journal_type, j.aggregate_id
         HAVING COALESCE(SUM(CASE WHEN e.side = 'DEBIT' THEN e.amount_minor ELSE 0 END), 0)
             <> COALESCE(SUM(CASE WHEN e.side = 'CREDIT' THEN e.amount_minor ELSE 0 END), 0)
          ORDER BY j.created_at DESC
          LIMIT 50`,
      );
      const totalsResult = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM ledger_journals) AS total_journals,
           (SELECT COALESCE(SUM(current_minor), 0)::text FROM payment_accounts) AS accounts_total_minor,
           (SELECT (COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_minor ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount_minor ELSE 0 END), 0))::text
              FROM ledger_entries
             WHERE account_ref LIKE 'payment-account:%') AS ledger_net_minor`,
      );
      const row = (totalsResult.rows[0] ?? {}) as Record<string, unknown>;
      const paymentAccountsTotal = BigInt(String(row.accounts_total_minor ?? "0"));
      const ledgerNet = BigInt(String(row.ledger_net_minor ?? "0"));
      const discrepancy = paymentAccountsTotal - ledgerNet;
      const unbalancedJournals = unbalancedResult.rows.map((entry) => ({
        journalId: String(entry.journal_id),
        journalType: String(entry.journal_type),
        aggregateId: String(entry.aggregate_id),
        debitMinor: String(entry.debit_minor),
        creditMinor: String(entry.credit_minor),
      }));
      return {
        status: unbalancedJournals.length === 0 && discrepancy === 0n ? "BALANCED" : "MISMATCH",
        checkedAt: nowIso(),
        unbalancedJournalCount: unbalancedJournals.length,
        totalJournalsChecked: asNumber(row.total_journals, 0),
        paymentAccountsTotalMinor: paymentAccountsTotal.toString(),
        ledgerPaymentAccountsNetMinor: ledgerNet.toString(),
        discrepancyMinor: discrepancy.toString(),
        unbalancedJournals,
      };
    });
  }
}
