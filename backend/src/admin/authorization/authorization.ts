import { conflictWithCode, unauthorized } from "../../errors.js";
import { hasPermission, type AdminPermission, type AdminSubject } from "./permissionRegistry.js";

export function requireStaffSession(subject: AdminSubject | null | undefined): AdminSubject {
  if (!subject) throw unauthorized("Staff session is required.");
  if (subject.status !== "ACTIVE") throw conflictWithCode("STAFF_ACCOUNT_LOCKED", "Staff account is not active.");
  return subject;
}

export function requirePermission(subject: AdminSubject, permission: AdminPermission, environmentScope = "preview"): void {
  if (!hasPermission(subject, permission, environmentScope)) {
    throw conflictWithCode("ADMIN_PERMISSION_DENIED", "Staff permission is not granted for this action.");
  }
}

export function requireFreshStepUp(subject: AdminSubject, maxAgeMs = 5 * 60 * 1000): void {
  const verified = subject.stepUpVerifiedAt ?? subject.mfaVerifiedAt;
  if (!verified || Date.now() - Date.parse(verified) > maxAgeMs) {
    throw conflictWithCode("STAFF_MFA_REQUIRED", "Fresh step-up MFA is required.");
  }
}
