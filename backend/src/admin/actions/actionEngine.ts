import { randomUUID } from "node:crypto";

import { conflictWithCode, invalidRequest, notFound } from "../../errors.js";
import { fingerprint } from "../../security.js";
import { redactAdminMetadata } from "../audit/redaction.js";
import { requireFreshStepUp, requirePermission } from "../authorization/authorization.js";
import { ADMIN_ROLES, type AdminPermission, type AdminSubject } from "../authorization/permissionRegistry.js";
import type { AdminActionRecord, AdminRepository } from "../repositories/adminRepository.js";

const APPROVAL_PERMISSION: Record<string, AdminPermission> = {
  CUSTOMER_ACCESS_LOCK: "customer.access-lock.approve", CUSTOMER_ACCESS_UNLOCK: "customer.access-lock.approve",
  ACCOUNT_BLOCK: "account.block.approve", ACCOUNT_UNBLOCK: "account.unblock.approve",
  SIMULATION_FUNDING: "simulation-funding.approve", SIMULATION_FUNDING_REVERSAL: "simulation-funding.reverse.approve",
  KYC_DECISION: "kyc.decision.approve", CREDIT_DECISION: "credit-application.decision.approve",
  TRANSFER_OPERATION: "transfer.action.approve", FRAUD_ACTION: "fraud.resolve.approve",
  OUTBOX_REQUEUE: "outbox.requeue.approve", JOB_RETRY: "job.retry.approve",
  STAFF_ROLE_CHANGE: "staff.role-change.approve", STAFF_DISABLE: "staff.disable.approve",
};

const REQUEST_PERMISSION: Record<string, AdminPermission> = {
  CUSTOMER_ACCESS_LOCK: "customer.access-lock.request", CUSTOMER_ACCESS_UNLOCK: "customer.access-unlock.request",
  ACCOUNT_BLOCK: "account.block.request", ACCOUNT_UNBLOCK: "account.unblock.request",
  SIMULATION_FUNDING: "simulation-funding.request", SIMULATION_FUNDING_REVERSAL: "simulation-funding.reverse.request",
  KYC_DECISION: "kyc.decision.request", CREDIT_DECISION: "credit-application.review",
  TRANSFER_OPERATION: "transfer.action.request", FRAUD_ACTION: "fraud.action.request",
  OUTBOX_REQUEUE: "outbox.requeue.request", JOB_RETRY: "job.retry.request",
  STAFF_ROLE_CHANGE: "staff.role-change.request", STAFF_DISABLE: "staff.disable.request",
};

function requireIdempotency(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 128) throw invalidRequest("Idempotency-Key is required for Admin commands.", { idempotencyKey: "Use a stable key with 8-128 characters." });
  return value.trim();
}

function requireReason(body: Record<string, unknown>): string {
  const reason = typeof body.reasonCode === "string" ? body.reasonCode.trim() : "";
  if (!/^[A-Z0-9_\-]{3,64}$/.test(reason)) throw invalidRequest("A reason code is required.", { reasonCode: "Use a normalized reason code." });
  return reason;
}

const ACTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  CUSTOMER_ACCESS_LOCK: ["reasonCode", "ticketReference", "description"],
  CUSTOMER_ACCESS_UNLOCK: ["reasonCode", "ticketReference", "description"],
  ACCOUNT_BLOCK: ["reasonCode", "ticketReference", "description"],
  ACCOUNT_UNBLOCK: ["reasonCode", "ticketReference", "description"],
  SIMULATION_FUNDING: ["reasonCode", "ticketReference", "description", "amountMinor", "currency"],
  SIMULATION_FUNDING_REVERSAL: ["reasonCode", "ticketReference", "description", "amountMinor", "currency", "sourceTransactionId"],
  KYC_DECISION: ["reasonCode", "ticketReference", "description", "decision"],
  CREDIT_DECISION: ["reasonCode", "ticketReference", "description", "decision", "approvedLimitMinor"],
  TRANSFER_OPERATION: ["reasonCode", "ticketReference", "description", "operation"],
  FRAUD_ACTION: ["reasonCode", "ticketReference", "description", "operation", "resolutionCode"],
  OUTBOX_REQUEUE: ["reasonCode", "ticketReference", "description"],
  JOB_RETRY: ["reasonCode", "ticketReference", "description"],
  STAFF_ROLE_CHANGE: ["reasonCode", "ticketReference", "description", "roleCode", "operation", "environmentScope"],
  STAFF_DISABLE: ["reasonCode", "ticketReference", "description"],
};

function rejectUnknownFields(actionType: string, body: Record<string, unknown>): void {
  const allowed = ACTION_FIELDS[actionType];
  if (!allowed) return;
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw invalidRequest("Request contains unsupported fields.", { [unknown[0]]: "This field is not accepted for the selected Admin command." });
}

export class AdminActionEngine {
  constructor(private readonly repository: AdminRepository) {}

  async create(input: { subject: AdminSubject; actionType: string; targetType: string; targetId: string; body: Record<string, unknown>; idempotencyKey: string; traceId: string }): Promise<AdminActionRecord> {
    const permission = REQUEST_PERMISSION[input.actionType];
    if (!permission) throw conflictWithCode("APPROVAL_POLICY_UNCONFIGURED", "This operation is not enabled in the Admin policy registry.");
    requirePermission(input.subject, permission);
    const idempotencyKey = requireIdempotency(input.idempotencyKey);
    rejectUnknownFields(input.actionType, input.body);
    const reasonCode = requireReason(input.body);
    const payload: Record<string, unknown> = { ...input.body, reasonCode };
    delete payload.token; delete payload.password; delete payload.otp; delete payload.totpSecret;
    const safePayload = redactAdminMetadata(payload) as Record<string, unknown>;
    if (input.actionType === "SIMULATION_FUNDING" || input.actionType === "SIMULATION_FUNDING_REVERSAL") {
      const amount = typeof safePayload.amountMinor === "string" || typeof safePayload.amountMinor === "number" ? String(safePayload.amountMinor) : "";
      if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) > 100_000_000n) throw conflictWithCode("FUNDING_LIMIT_EXCEEDED", "Simulation funding amount is outside the per-request limit.");
      safePayload.amountMinor = amount;
      safePayload.currency = "VND";
      if (typeof safePayload.ticketReference !== "string" || safePayload.ticketReference.trim().length < 3) throw invalidRequest("ticketReference is required.");
      if (input.actionType === "SIMULATION_FUNDING_REVERSAL" && (typeof safePayload.sourceTransactionId !== "string" || safePayload.sourceTransactionId.trim().length < 3)) throw invalidRequest("sourceTransactionId is required for a funding reversal request.");
    }
    let expectedTargetVersion: number | null = null;
    let expectedTargetStatus: string | null = null;
    if (input.targetType === "ACCOUNT") {
      const target = await this.repository.findAccount(input.targetId);
      if (!target) throw notFound("Target account not found.");
      expectedTargetVersion = target.version;
      expectedTargetStatus = target.status;
      if ((input.actionType === "ACCOUNT_BLOCK" && target.status === "BLOCKED") || (input.actionType === "ACCOUNT_UNBLOCK" && target.status === "ACTIVE")) throw conflictWithCode("ACCOUNT_STATUS_CONFLICT", "Account is already in the requested status.");
    }
    if (input.targetType === "CUSTOMER") {
      const target = await this.repository.findCustomer(input.targetId);
      if (!target) throw notFound("Target customer not found.");
      expectedTargetVersion = target.accessVersion;
      expectedTargetStatus = target.accessStatus;
      if ((input.actionType === "CUSTOMER_ACCESS_LOCK" && target.accessStatus === "LOCKED") || (input.actionType === "CUSTOMER_ACCESS_UNLOCK" && target.accessStatus === "ACTIVE")) throw conflictWithCode("ACCOUNT_STATUS_CONFLICT", "Customer access is already in the requested status.");
    }
    if (input.targetType === "STAFF" && (input.actionType === "STAFF_ROLE_CHANGE" || input.actionType === "STAFF_DISABLE")) {
      const target = await this.repository.findStaffById(input.targetId);
      if (!target) throw notFound("Target staff not found.");
      expectedTargetVersion = target.authorizationVersion;
      expectedTargetStatus = target.status;
      if (input.actionType === "STAFF_DISABLE" && target.status === "DISABLED") throw conflictWithCode("STAFF_STATUS_CONFLICT", "Staff account is already disabled.");
      if (input.actionType === "STAFF_ROLE_CHANGE") {
        const roleCode = typeof safePayload.roleCode === "string" ? safePayload.roleCode.trim() : "";
        const operation = typeof safePayload.operation === "string" ? safePayload.operation.trim().toUpperCase() : "";
        const scope = typeof safePayload.environmentScope === "string" ? safePayload.environmentScope.trim().toLowerCase() : "preview";
        if (!ADMIN_ROLES.includes(roleCode as (typeof ADMIN_ROLES)[number]) || !["GRANT", "REVOKE"].includes(operation) || !["preview", "production"].includes(scope)) throw invalidRequest("Staff role change fields are invalid.");
        safePayload.roleCode = roleCode;
        safePayload.operation = operation;
        safePayload.environmentScope = scope;
      }
    }
    if (input.targetType === "KYC_APPLICATION" || input.targetType === "CREDIT_APPLICATION") {
      const applicationType = input.targetType === "KYC_APPLICATION" ? "KYC" : "CREDIT";
      const target = await this.repository.findApplication(applicationType, input.targetId);
      if (!target) throw notFound("Application not found.");
      expectedTargetVersion = target.version;
      expectedTargetStatus = target.status;
      if (target.status !== "SUBMITTED" && target.status !== "UNDER_REVIEW") throw conflictWithCode("CASE_STATUS_CONFLICT", "Application is not awaiting a decision.");
      const decision = typeof safePayload.decision === "string" ? safePayload.decision : "";
      const allowed = applicationType === "KYC" ? ["APPROVED", "REJECTED", "NEEDS_MORE_INFO"] : ["PENDING_ACTIVATION", "REJECTED"];
      if (!allowed.includes(decision)) throw invalidRequest("A valid application decision is required.");
      safePayload.applicationType = applicationType;
      safePayload.decision = decision;
    }
    if (input.targetType === "TRANSFER") {
      const target = await this.repository.findTransfer(input.targetId);
      if (!target) throw notFound("Transfer not found.");
      expectedTargetVersion = target.version;
      expectedTargetStatus = target.status;
      const operation = typeof safePayload.operation === "string" ? safePayload.operation : "";
      if (!['RETRY', 'CANCEL', 'REVERSAL'].includes(operation)) throw invalidRequest("A valid transfer operation is required.");
      if (operation === "CANCEL" && target.status !== "PENDING") throw conflictWithCode("TRANSFER_NOT_CANCELABLE", "Only pending transfers can be cancelled.");
      if (operation === "RETRY" && !['PENDING', 'FAILED'].includes(target.status)) throw conflictWithCode("TRANSFER_NOT_RETRYABLE", "Only pending or failed transfers can be retried.");
      if (operation === "REVERSAL" && target.status !== "SUCCEEDED") throw conflictWithCode("TRANSFER_NOT_REVERSIBLE", "Only succeeded transfers can be reversed.");
      safePayload.operation = operation;
    }
    if (input.targetType === "FRAUD_CASE") {
      const target = await this.repository.findFraudCase(input.targetId);
      if (!target) throw notFound("Fraud case not found.");
      expectedTargetVersion = target.version;
      expectedTargetStatus = target.status;
      const operation = typeof safePayload.operation === "string" ? safePayload.operation : "";
      if (!['BLOCK', 'REVOKE', 'REVERSAL', 'RESOLVE'].includes(operation)) throw invalidRequest("A valid fraud operation is required.");
      if (operation === "RESOLVE" && !['CONFIRMED_FRAUD', 'NOT_FRAUD', 'DUPLICATE', 'INSUFFICIENT_INFORMATION', 'CUSTOMER_WITHDREW'].includes(String(safePayload.resolutionCode ?? ""))) throw invalidRequest("A valid fraud resolution code is required.");
      safePayload.operation = operation;
    }
    if (input.targetType === "JOB") {
      const target = await this.repository.findJob(input.targetId);
      if (!target) throw notFound("Job not found.");
      expectedTargetVersion = target.attempts;
      expectedTargetStatus = target.status;
      if (!['FAILED', 'DEAD'].includes(target.status)) throw conflictWithCode("JOB_NOT_RETRYABLE", "Job is not retryable.");
    }
    if (input.targetType === "OUTBOX_EVENT") {
      const target = await this.repository.findOutboxEvent(input.targetId);
      if (!target) throw notFound("Outbox event not found.");
      expectedTargetVersion = Number(target.attempts ?? 0);
      expectedTargetStatus = String(target.status);
      if (!['DEAD', 'SKIPPED'].includes(String(target.status)) || target.requeueable !== true) throw conflictWithCode("OUTBOX_NOT_REQUEUEABLE", "Outbox event is not requeueable.");
      safePayload.eventId = input.targetId;
    }
    const requestFingerprint = fingerprint({ actionType: input.actionType, targetType: input.targetType, targetId: input.targetId, payload: safePayload, expectedTargetVersion, expectedTargetStatus });
    const action = await this.repository.createAction({ actionType: input.actionType, requesterStaffId: input.subject.staffId, targetType: input.targetType, targetId: input.targetId, requestFingerprint, policyVersion: "admin-p0-v1", idempotencyKey, expectedTargetVersion, expectedTargetStatus, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), payload: safePayload });
    if (action.requestFingerprint !== requestFingerprint) throw conflictWithCode("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different Admin command.");
    await this.repository.appendAudit({ id: randomUUID(), actorStaffId: input.subject.staffId, action: "ADMIN_ACTION_CREATED", targetType: input.targetType, targetId: input.targetId, outcome: "PENDING_APPROVAL", reasonCode, requestId: action.id, traceId: input.traceId, correlationId: null, beforeVersion: expectedTargetVersion, afterVersion: null, metadata: { actionType: input.actionType, ticketReference: safePayload.ticketReference ?? null } });
    return action;
  }

  async approve(input: { subject: AdminSubject; requestId: string; body: Record<string, unknown>; traceId: string }): Promise<AdminActionRecord> {
    const action = await this.repository.findAction(input.requestId);
    if (!action) throw notFound("Admin action not found.");
    const permission = APPROVAL_PERMISSION[action.actionType];
    if (!permission) throw conflictWithCode("APPROVAL_POLICY_UNCONFIGURED", "Action approval policy is not configured.");
    requirePermission(input.subject, permission);
    requireFreshStepUp(input.subject);
    const approvedFingerprint = typeof input.body.fingerprint === "string" ? input.body.fingerprint : "";
    if (!approvedFingerprint || approvedFingerprint !== action.requestFingerprint) throw conflictWithCode("ACTION_FINGERPRINT_MISMATCH", "The reviewed action fingerprint does not match the submitted action.");
    if (input.body.version !== undefined) {
      const submittedVersion = Number(input.body.version);
      const isDecisionRecovery = action.status === "APPROVED" && submittedVersion === action.version - 1;
      // A completed action is an idempotent receipt. An approver may retry the
      // exact approval request after losing the response, so the original
      // approval-view version remains acceptable after the server has advanced
      // the action state.
      const isCompletedReplay = action.status === "SUCCEEDED" && submittedVersion <= action.version;
      if (submittedVersion !== action.version && !isDecisionRecovery && !isCompletedReplay) throw conflictWithCode("ACTION_STALE", "The approval view is stale; reload the action before approving.");
    }
    const reasonCode = requireReason(input.body);
    const decision = typeof input.body.decision === "string" ? input.body.decision : "APPROVED";
    if (decision !== "APPROVED") throw invalidRequest("Use the reject endpoint for a rejection.");
    // A process can die after the decision transaction commits but before the
    // execution transaction starts. Keep approval retryable in that narrow
    // window; the repository's FOR UPDATE execution gate still guarantees a
    // single domain mutation. A completed action is an idempotent replay.
    if (action.status === "SUCCEEDED") return action;
    if (action.status !== "PENDING_APPROVAL" && action.status !== "APPROVED") throw conflictWithCode("ACTION_ALREADY_DECIDED", "Action is no longer awaiting approval.");
    if (Date.parse(action.expiresAt) <= Date.now()) { await this.repository.updateActionStatus(action.id, "EXPIRED", { failureCode: "ACTION_EXPIRED" }); throw conflictWithCode("ACTION_EXPIRED", "Action approval window has expired."); }
    if (action.status === "PENDING_APPROVAL") {
      await this.repository.decideAction({ requestId: action.id, reviewerStaffId: input.subject.staffId, decision: "APPROVED", approvedFingerprint, reasonCode, comment: typeof input.body.comment === "string" ? input.body.comment : null, mfaVerifiedAt: input.subject.stepUpVerifiedAt ?? new Date().toISOString() });
    }
    const executed = await this.repository.executeApprovedAction({ requestId: action.id, approverStaffId: input.subject.staffId, traceId: input.traceId });
    if (executed.status === "STALE") throw conflictWithCode("ACTION_STALE", "Target changed before approval; create a new action.");
    if (executed.status === "FAILED") throw conflictWithCode(executed.failureCode ?? "ACTION_EXECUTION_FAILED", "Approved action could not be executed.");
    await this.repository.appendAudit({ id: randomUUID(), actorStaffId: input.subject.staffId, action: "ADMIN_ACTION_APPROVED", targetType: action.targetType, targetId: action.targetId, outcome: "SUCCEEDED", reasonCode, requestId: action.id, traceId: input.traceId, correlationId: null, beforeVersion: executed.beforeVersion ?? action.expectedTargetVersion, afterVersion: executed.afterVersion ?? null, metadata: { actionType: action.actionType, resultResourceId: executed.resultResourceId ?? null } });
    return (await this.repository.findAction(action.id))!;
  }

  async reject(input: { subject: AdminSubject; requestId: string; body: Record<string, unknown>; traceId: string }): Promise<AdminActionRecord> {
    const action = await this.repository.findAction(input.requestId); if (!action) throw notFound("Admin action not found.");
    const permission = APPROVAL_PERMISSION[action.actionType]; if (!permission) throw conflictWithCode("APPROVAL_POLICY_UNCONFIGURED", "Action approval policy is not configured.");
    requirePermission(input.subject, permission); requireFreshStepUp(input.subject);
    const reasonCode = requireReason(input.body); const fingerprintValue = typeof input.body.fingerprint === "string" ? input.body.fingerprint : ""; if (fingerprintValue !== action.requestFingerprint) throw conflictWithCode("ACTION_FINGERPRINT_MISMATCH", "The reviewed action fingerprint does not match.");
    if (input.body.version !== undefined) {
      const submittedVersion = Number(input.body.version);
      const isDecisionReplay = action.status === "REJECTED" && (submittedVersion === action.version - 1 || submittedVersion === action.version);
      if (submittedVersion !== action.version && !isDecisionReplay) throw conflictWithCode("ACTION_STALE", "The approval view is stale; reload the action before rejecting.");
    }
    // A lost response must be safe to retry with the same reviewed payload.
    // The rejection is already a terminal receipt and must not append a second
    // decision or mutate the target.
    if (action.status === "REJECTED") return action;
    if (action.status !== "PENDING_APPROVAL") throw conflictWithCode("ACTION_ALREADY_DECIDED", "Action is no longer awaiting approval.");
    await this.repository.decideAction({ requestId: action.id, reviewerStaffId: input.subject.staffId, decision: "REJECTED", approvedFingerprint: fingerprintValue, reasonCode, comment: typeof input.body.comment === "string" ? input.body.comment : null, mfaVerifiedAt: input.subject.stepUpVerifiedAt ?? new Date().toISOString() });
    await this.repository.appendAudit({ id: randomUUID(), actorStaffId: input.subject.staffId, action: "ADMIN_ACTION_REJECTED", targetType: action.targetType, targetId: action.targetId, outcome: "REJECTED", reasonCode, requestId: action.id, traceId: input.traceId, correlationId: null, beforeVersion: action.version, afterVersion: null, metadata: {} });
    return (await this.repository.findAction(action.id))!;
  }

  async cancel(subject: AdminSubject, requestId: string, traceId: string): Promise<AdminActionRecord> {
    const action = await this.repository.findAction(requestId); if (!action) throw notFound("Admin action not found.");
    if (action.requesterStaffId !== subject.staffId) throw conflictWithCode("ADMIN_PERMISSION_DENIED", "Only the maker can cancel a pending action.");
    if (action.status !== "PENDING_APPROVAL") throw conflictWithCode("ACTION_ALREADY_DECIDED", "Action is no longer pending.");
    const updated = await this.repository.updateActionStatus(requestId, "CANCELLED");
    await this.repository.appendAudit({ id: randomUUID(), actorStaffId: subject.staffId, action: "ADMIN_ACTION_CANCELLED", targetType: action.targetType, targetId: action.targetId, outcome: "CANCELLED", reasonCode: "MAKER_CANCELLED", requestId, traceId, correlationId: null, beforeVersion: action.version, afterVersion: updated.version, metadata: {} });
    return updated;
  }
}
