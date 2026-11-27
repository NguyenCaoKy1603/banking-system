export const ADMIN_ROLES = ["OPERATIONS", "ADMIN"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Canonicalize role values stored in immutable pending action payloads before
 * the two-role migration. New API input must still be validated against
 * ADMIN_ROLES directly.
 */
export function normalizeExistingAdminRole(value: string): AdminRole | null {
  switch (value) {
    case "OPERATIONS":
    case "ADMIN":
      return value;
    case "SUPPORT":
      return "OPERATIONS";
    case "CONTROL":
      return "ADMIN";
    default:
      return null;
  }
}

export const ADMIN_PERMISSIONS = [
  "customer.read.masked", "customer.read.pii", "customer.access-lock.request", "customer.access-unlock.request", "customer.access-lock.approve",
  "account.read", "account.number.reveal", "account.block.request", "account.block.approve", "account.unblock.request", "account.unblock.approve",
  "simulation-funding.read", "simulation-funding.request", "simulation-funding.approve", "simulation-funding.reverse.request", "simulation-funding.reverse.approve",
  "kyc.read", "kyc.review", "kyc.decision.request", "kyc.decision.approve",
  "credit-application.read", "credit-application.review", "credit-application.decision.approve",
  "transfer.pending.read", "transfer.action.request", "transfer.action.approve",
  "outbox.read", "outbox.requeue.request", "outbox.requeue.approve", "job.read", "job.retry.request", "job.retry.approve",
  "staff.read", "staff.operations-account.create", "staff.role-change.request", "staff.role-change.approve", "staff.disable.request", "staff.disable.approve",
  "audit.read", "audit.export",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const set = (...permissions: AdminPermission[]): ReadonlySet<AdminPermission> => new Set(permissions);

export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, ReadonlySet<AdminPermission>>> = Object.freeze({
  OPERATIONS: set(
    "customer.read.masked", "customer.read.pii", "customer.access-lock.request", "customer.access-unlock.request", "customer.access-lock.approve",
    "account.read", "account.block.request", "account.block.approve", "account.unblock.request", "account.unblock.approve",
    "simulation-funding.read", "simulation-funding.request", "simulation-funding.approve", "simulation-funding.reverse.request", "simulation-funding.reverse.approve",
    "kyc.read", "kyc.review", "kyc.decision.request", "kyc.decision.approve",
    "credit-application.read", "credit-application.review", "credit-application.decision.approve",
    "transfer.pending.read", "transfer.action.request", "transfer.action.approve",
    "outbox.read", "outbox.requeue.request", "outbox.requeue.approve", "job.read", "job.retry.request", "job.retry.approve", "staff.read",
  ),
  ADMIN: set(
    "customer.read.masked", "customer.read.pii", "customer.access-lock.request", "customer.access-unlock.request", "customer.access-lock.approve", "account.read", "account.block.approve", "account.unblock.approve",
    "simulation-funding.read", "simulation-funding.approve", "simulation-funding.reverse.approve", "kyc.read", "kyc.decision.approve",
    "credit-application.read", "credit-application.decision.approve", "transfer.pending.read", "transfer.action.approve",
    "outbox.read", "outbox.requeue.approve", "job.read", "job.retry.approve", "staff.read", "staff.operations-account.create", "staff.role-change.approve", "staff.disable.approve", "audit.read", "audit.export",
    "staff.role-change.request", "staff.disable.request", "audit.read",
  ),
});

export type AdminSubject = {
  staffId: string;
  status: "INVITED" | "ACTIVE" | "LOCKED" | "DISABLED";
  authorizationVersion: number;
  roles: readonly { role: AdminRole; environmentScope: string; expiresAt: string | null }[];
  mfaVerifiedAt?: string | null;
  stepUpVerifiedAt?: string | null;
};

export function resolvePermissions(subject: AdminSubject, environmentScope = "preview"): ReadonlySet<AdminPermission> {
  if (subject.status !== "ACTIVE") return new Set();
  const now = Date.now();
  const result = new Set<AdminPermission>();
  for (const assignment of subject.roles) {
    if (assignment.environmentScope !== environmentScope) continue;
    if (assignment.expiresAt && Date.parse(assignment.expiresAt) <= now) continue;
    for (const permission of ROLE_PERMISSIONS[assignment.role]) result.add(permission);
  }
  return result;
}

export function hasPermission(subject: AdminSubject, permission: AdminPermission, environmentScope = "preview"): boolean {
  return resolvePermissions(subject, environmentScope).has(permission);
}

export type AdminRouteDefinition = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  permission?: AdminPermission;
  stateChanging?: boolean;
};

// Every Admin API endpoint is declared here. The HTTP dispatcher refuses to
// execute an undeclared path (deny-by-default), and CI validates this registry.
export const ADMIN_ROUTES: readonly AdminRouteDefinition[] = [
  { method: "POST", path: "/admin/auth/login", stateChanging: true },
  { method: "POST", path: "/admin/auth/mfa/verify", stateChanging: true },
  { method: "POST", path: "/admin/auth/step-up", stateChanging: true },
  { method: "POST", path: "/admin/auth/refresh", stateChanging: true },
  { method: "POST", path: "/admin/auth/logout", stateChanging: true },
  { method: "POST", path: "/admin/auth/activate", stateChanging: true },
  { method: "GET", path: "/admin/me" },
  { method: "GET", path: "/admin/me/sessions" },
  { method: "DELETE", path: "/admin/me/sessions/{sessionId}", stateChanging: true },
  { method: "GET", path: "/admin/staff", permission: "staff.read" },
  { method: "GET", path: "/admin/staff/{staffId}", permission: "staff.read" },
  { method: "GET", path: "/admin/roles", permission: "staff.read" },
  { method: "GET", path: "/admin/permissions", permission: "staff.read" },
  { method: "POST", path: "/admin/staff/operations-accounts/mfa-setup", permission: "staff.operations-account.create", stateChanging: true },
  { method: "POST", path: "/admin/staff/operations-accounts", permission: "staff.operations-account.create", stateChanging: true },
  { method: "POST", path: "/admin/staff/{staffId}/role-change-requests", permission: "staff.role-change.request", stateChanging: true },
  { method: "POST", path: "/admin/staff/{staffId}/disable-requests", permission: "staff.disable.request", stateChanging: true },
  { method: "GET", path: "/admin/customers", permission: "customer.read.masked" },
  { method: "GET", path: "/admin/customers/{customerId}", permission: "customer.read.masked" },
  { method: "GET", path: "/admin/customers/{customerId}/accounts", permission: "account.read" },
  { method: "GET", path: "/admin/accounts/{accountId}", permission: "account.read" },
  { method: "GET", path: "/admin/accounts/{accountId}/transactions", permission: "account.read" },
  { method: "POST", path: "/admin/customers/{customerId}/access-lock-requests", permission: "customer.access-lock.request", stateChanging: true },
  { method: "POST", path: "/admin/customers/{customerId}/access-unlock-requests", permission: "customer.access-unlock.request", stateChanging: true },
  { method: "POST", path: "/admin/accounts/{accountId}/block-requests", permission: "account.block.request", stateChanging: true },
  { method: "POST", path: "/admin/accounts/{accountId}/unblock-requests", permission: "account.unblock.request", stateChanging: true },
  { method: "POST", path: "/admin/accounts/{accountId}/funding-requests", permission: "simulation-funding.request", stateChanging: true },
  { method: "POST", path: "/admin/accounts/{accountId}/funding-reversal-requests", permission: "simulation-funding.reverse.request", stateChanging: true },
  { method: "GET", path: "/admin/approvals", permission: "audit.read" },
  { method: "GET", path: "/admin/approvals/{requestId}", permission: "audit.read" },
  { method: "POST", path: "/admin/approvals/{requestId}/approve", permission: "audit.read", stateChanging: true },
  { method: "POST", path: "/admin/approvals/{requestId}/reject", permission: "audit.read", stateChanging: true },
  { method: "POST", path: "/admin/approvals/{requestId}/cancel", permission: "audit.read", stateChanging: true },
  { method: "GET", path: "/admin/applications", permission: "kyc.read" },
  { method: "GET", path: "/admin/kyc-applications/{applicationId}", permission: "kyc.read" },
  { method: "POST", path: "/admin/kyc-applications/{applicationId}/claim", permission: "kyc.review", stateChanging: true },
  { method: "POST", path: "/admin/kyc-applications/{applicationId}/review-recommendations", permission: "kyc.decision.request", stateChanging: true },
  { method: "GET", path: "/admin/credit-applications/{applicationId}", permission: "credit-application.read" },
  { method: "POST", path: "/admin/credit-applications/{applicationId}/claim", permission: "credit-application.review", stateChanging: true },
  { method: "POST", path: "/admin/credit-applications/{applicationId}/review-recommendations", permission: "credit-application.review", stateChanging: true },
  { method: "GET", path: "/admin/transfers", permission: "transfer.pending.read" },
  { method: "GET", path: "/admin/transfers/{transferId}", permission: "transfer.pending.read" },
  { method: "GET", path: "/admin/transfers/{transferId}/timeline", permission: "transfer.pending.read" },
  { method: "POST", path: "/admin/transfers/{transferId}/retry-requests", permission: "transfer.action.request", stateChanging: true },
  { method: "POST", path: "/admin/transfers/{transferId}/cancel-requests", permission: "transfer.action.request", stateChanging: true },
  { method: "POST", path: "/admin/transfers/{transferId}/reversal-requests", permission: "transfer.action.request", stateChanging: true },
  { method: "GET", path: "/admin/anomalies", permission: "transfer.pending.read" },
  { method: "POST", path: "/admin/anomalies/{anomalyId}/resolve", permission: "transfer.action.request", stateChanging: true },
  { method: "GET", path: "/admin/operations/outbox/summary", permission: "outbox.read" },
  { method: "GET", path: "/admin/operations/outbox/events", permission: "outbox.read" },
  { method: "GET", path: "/admin/operations/outbox/events/{eventId}", permission: "outbox.read" },
  { method: "GET", path: "/admin/operations/outbox/dead-letters", permission: "outbox.read" },
  { method: "POST", path: "/admin/operations/outbox/events/{eventId}/requeue-requests", permission: "outbox.requeue.request", stateChanging: true },
  { method: "GET", path: "/admin/operations/jobs", permission: "job.read" },
  { method: "GET", path: "/admin/operations/jobs/{jobId}", permission: "job.read" },
  { method: "POST", path: "/admin/operations/jobs/{jobId}/retry-requests", permission: "job.retry.request", stateChanging: true },
  { method: "GET", path: "/admin/audit-events", permission: "audit.read" },
  { method: "GET", path: "/admin/audit-events/{eventId}", permission: "audit.read" },
  { method: "POST", path: "/admin/audit-export-requests", permission: "audit.export", stateChanging: true },
  { method: "GET", path: "/admin/audit-exports/{exportId}", permission: "audit.export" },
  { method: "GET", path: "/admin/control-policy", permission: "audit.read" },
  { method: "PATCH", path: "/admin/control-policy", permission: "audit.read", stateChanging: true },
  { method: "GET", path: "/admin/operations/ledger-reconciliation", permission: "outbox.read" },
];

export function assertAdminRouteRegistry(): void {
  const seen = new Set<string>();
  for (const route of ADMIN_ROUTES) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`Duplicate Admin route: ${key}`);
    seen.add(key);
    if (!route.path.startsWith("/admin/")) throw new Error(`Admin route outside namespace: ${key}`);
    if (route.stateChanging && !route.permission && !route.path.startsWith("/admin/auth/") && !route.path.startsWith("/admin/me/")) {
      throw new Error(`State-changing Admin route has no permission: ${key}`);
    }
  }
}

assertAdminRouteRegistry();
