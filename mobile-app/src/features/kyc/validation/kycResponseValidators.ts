import type { KycApplication } from "@/features/kyc/types/kyc";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const statuses = new Set([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_MORE_INFO",
  "APPROVED",
  "REJECTED",
]);

export function isKycApplication(value: unknown): value is KycApplication {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    typeof value.fullName === "string" &&
    !Object.prototype.hasOwnProperty.call(value, "identityNumber") &&
    typeof value.identityNumberLast4 === "string" &&
    /^\d{4}$/.test(value.identityNumberLast4) &&
    typeof value.address === "string" &&
    typeof value.documentUri === "string" &&
    typeof value.status === "string" && statuses.has(value.status) &&
    (value.rejectionReason === null || typeof value.rejectionReason === "string") &&
    (value.submittedAt === null || typeof value.submittedAt === "string") &&
    typeof value.updatedAt === "string" &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version >= 1
  );
}

export function isKycApplicationResponse(value: unknown): value is { application: KycApplication | null } {
  return isRecord(value) && (value.application === null || isKycApplication(value.application));
}
