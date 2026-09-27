export type AdminRole = "SUPPORT" | "OPERATIONS" | "CONTROL" | "ADMIN";

export type StaffRole = {
  role: AdminRole;
  environmentScope: string;
  expiresAt: string | null;
};

export type Staff = {
  id: string;
  employeeCode: string;
  email: string;
  displayName: string;
  status: "INVITED" | "ACTIVE" | "LOCKED" | "DISABLED";
  roles: StaffRole[];
  permissions?: string[];
  mfaEnrolled?: boolean;
  createdAt?: string;
};

export type ActionStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "SUCCEEDED"
  | "FAILED"
  | "EXPIRED"
  | "STALE";

export type Action = {
  id: string;
  actionType: string;
  requesterStaffId: string;
  targetType: string;
  targetId: string;
  requestFingerprint: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  expiresAt: string;
  resultResourceId: string | null;
  version: number;
};

export type Account = {
  id: string;
  customerId?: string;
  displayName: string;
  maskedNumber: string;
  bankName?: string;
  status: "ACTIVE" | "BLOCKED" | "CLOSED";
  availableMinor: string;
  currentMinor: string;
  heldMinor?: string;
  version: number;
  updatedAt?: string;
};

export type Customer = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  accessStatus: "ACTIVE" | "LOCKED";
  accessVersion?: number;
  createdAt?: string;
};

export type Transaction = {
  id: string;
  accountId: string;
  reference: string;
  amountMinor: string;
  currency: string;
  direction: "CREDIT" | "DEBIT";
  status: string;
  description?: string;
  createdAt: string;
};

export type Application = {
  id: string;
  applicationType: "KYC" | "CREDIT";
  customerId: string;
  status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO" | "PENDING_ACTIVATION";
  version: number;
  applicantLabel?: string;
  requestedLimitMinor?: string;
  approvedLimitMinor?: string | null;
  assignedStaffId?: string | null;
  decisionReasonCode?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type Transfer = {
  id: string;
  customerId: string;
  sourceAccountId: string;
  reference: string;
  amountMinor: string;
  feeMinor: string;
  currency: string;
  status: "PENDING" | "FAILED" | "SUCCEEDED" | "CANCELLED";
  version: number;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type TransferTimelineItem = {
  id: string;
  status: string;
  message?: string;
  occurredAt: string;
};

export type FraudCase = {
  id: string;
  customerId: string;
  accountId: string;
  transactionId: string;
  reasonPreview: string;
  status: "RECEIVED" | "UNDER_INVESTIGATION" | "RESOLVED" | "CLOSED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  assignedStaffId: string | null;
  resolutionCode: string | null;
  version: number;
  createdAt: string;
  updatedAt?: string;
};

export type FraudTimelineItem = {
  id: string;
  action: string;
  staffId?: string;
  note?: string;
  occurredAt: string;
};

export type Job = {
  id: string;
  jobType: string;
  status: "PENDING" | "RUNNING" | "FAILED" | "DEAD" | "COMPLETED";
  attempts: number;
  lastErrorCode: string | null;
  leaseExpiresAt?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type OutboxEvent = {
  id: string;
  eventType: string;
  aggregateId: string;
  aggregateType?: string;
  status: "PENDING" | "PROCESSING" | "DEAD" | "SKIPPED";
  attempts: number;
  lastErrorCode: string | null;
  requeueable?: boolean;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

export type AuditEvent = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: "SUCCEEDED" | "DENIED" | "FAILED" | "PENDING";
  reasonCode: string | null;
  actorStaffId: string | null;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

export type RoleDefinition = {
  id: string;
  roleCode: string;
  displayName: string;
  description: string;
};

export type PermissionDefinition = {
  id: string;
  permissionCode: string;
  groupName: string;
  description: string;
};

export type NavTab =
  | "overview"
  | "approvals"
  | "customers"
  | "kyc"
  | "credit"
  | "transfers"
  | "fraud"
  | "operations"
  | "staff"
  | "audit";
