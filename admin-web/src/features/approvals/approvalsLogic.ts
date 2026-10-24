export const APPROVAL_PERMISSION_MAP: Record<string, string> = {
  CUSTOMER_ACCESS_LOCK: "customer.access-lock.approve",
  CUSTOMER_ACCESS_UNLOCK: "customer.access-lock.approve",
  ACCOUNT_BLOCK: "account.block.approve",
  ACCOUNT_UNBLOCK: "account.unblock.approve",
  SIMULATION_FUNDING: "simulation-funding.approve",
  SIMULATION_FUNDING_REVERSAL: "simulation-funding.reverse.approve",
  KYC_DECISION: "kyc.decision.approve",
  CREDIT_DECISION: "credit-application.decision.approve",
  TRANSFER_OPERATION: "transfer.action.approve",
  OUTBOX_REQUEUE: "outbox.requeue.approve",
  JOB_RETRY: "job.retry.approve",
  STAFF_ROLE_CHANGE: "staff.role-change.approve",
  STAFF_DISABLE: "staff.disable.approve",
};

/**
 * Returns the exact permission code required to approve or reject this actionType.
 * Unknown action types return undefined (strict deny: permissions are never assumed).
 */
export function getRequiredApprovalPermission(actionType: string): string | undefined {
  return APPROVAL_PERMISSION_MAP[actionType];
}

/**
 * Checks if the staff has permission to approve the action.
 * Strict deny: unknown action types always evaluate to false.
 */
export function canStaffApproveAction(
  actionType: string,
  hasPermission: (permission: string) => boolean
): boolean {
  const perm = getRequiredApprovalPermission(actionType);
  if (!perm) return false;
  return hasPermission(perm);
}

/**
 * Resolves the API endpoint path and body for an approval decision.
 */
export function resolveDecisionEndpointAndBody(
  action: { id: string; requestFingerprint: string; version: number },
  decision: "APPROVED" | "REJECTED",
  reason: string
): { path: string; body: Record<string, unknown> } {
  const isApprove = decision === "APPROVED";
  const path = isApprove
    ? `/admin/approvals/${action.id}/approve`
    : `/admin/approvals/${action.id}/reject`;
  const body: Record<string, unknown> = {
    fingerprint: action.requestFingerprint,
    version: action.version,
    reasonCode: reason.trim(),
    comment: reason.trim(),
  };
  if (isApprove) {
    body.decision = "APPROVED";
  }
  return { path, body };
}
