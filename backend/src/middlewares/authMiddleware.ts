import type { IncomingMessage } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { conflictWithCode, invalidRequest, unauthorized } from "../errors.js";
import { header, requireDeviceId } from "../routes/httpUtils.js";
import type { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import type {
  MfaChallengePurpose,
  PersistentMfaService,
} from "../mfa/persistentMfaService.js";
import type { OtpPurpose } from "../types.js";

export type RequireBearerFn = (
  request: IncomingMessage,
  system: BankingSystem,
  options: HttpOptions,
  relationalAuth?: RelationalHttpBoundary,
) => Promise<string>;

export async function requireBearer(
  request: IncomingMessage,
  system: BankingSystem,
  options: HttpOptions,
  relationalAuth?: RelationalHttpBoundary,
): Promise<string> {
  const authorization = header(request, "authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw unauthorized("Access token is required.");
  }
  const deviceId = header(request, "x-device-id");
  if (!deviceId?.trim()) {
    throw unauthorized("Device binding is required.");
  }
  const userId = (
    relationalAuth
      ? await relationalAuth.authenticate(authorization.slice("Bearer ".length), deviceId)
      : system.authenticate(authorization.slice("Bearer ".length), deviceId)
  ).id;
  if (options.customerAccessStatus && (await options.customerAccessStatus(userId)) === "LOCKED") {
    throw unauthorized("Customer access is locked by the control plane.");
  }
  return userId;
}

export type PersistentStepUpPurpose = Extract<
  MfaChallengePurpose,
  | "TRANSFER"
  | "SAVINGS_OPENING"
  | "SAVINGS_WITHDRAWAL"
  | "CREDIT_APPLICATION"
  | "CARD_ACTIVATION"
  | "CREDIT_PAYMENT"
  | "CARD_UNLOCK"
  | "CARD_REPORT_LOST"
  | "RECOVERY_CODE_ROTATION"
  | "MFA_FACTOR_CHANGE"
  | "MFA_FACTOR_REMOVAL"
  | "PASSWORD_CHANGE"
>;

export async function verifyPersistentStepUp(
  mfaService: PersistentMfaService,
  system: BankingSystem,
  request: IncomingMessage,
  userId: string,
  data: Record<string, unknown>,
  purpose: PersistentStepUpPurpose,
  resourceId: string | null,
  suppliedFingerprint?: string | null,
): Promise<void> {
  const rawStepUp = data.stepUp;
  if (typeof rawStepUp !== "object" || rawStepUp === null || Array.isArray(rawStepUp)) {
    throw invalidRequest("stepUp is required for this command.");
  }
  const stepUp = rawStepUp as Record<string, unknown>;
  if (stepUp.method !== "TOTP" && stepUp.method !== "BIOMETRIC") {
    throw conflictWithCode("STEP_UP_INVALID", "Production-like runtime chỉ chấp nhận TOTP hoặc Sinh trắc học cho step-up.");
  }
  const verifiedMethod = stepUp.method as "TOTP" | "BIOMETRIC";
  if (typeof stepUp.challengeId !== "string" || !stepUp.challengeId.trim()) {
    throw invalidRequest("stepUp.challengeId is required.");
  }
  if (typeof stepUp.proof !== "string" || !stepUp.proof.trim()) {
    throw invalidRequest("stepUp.proof is required.");
  }
  const deviceId = requireDeviceId(request);
  const requestFingerprint = system.getStepUpRequestFingerprint(
    purpose as OtpPurpose,
    resourceId,
    suppliedFingerprint,
  );
  const result = await mfaService.verifyChallenge({
    challengeId: stepUp.challengeId,
    customerId: userId,
    deviceId,
    proof: stepUp.proof,
    purpose,
    resourceId,
    requestFingerprint,
  });
  if (result.customerId !== userId) {
    throw unauthorized("MFA user binding is invalid.");
  }
  system.registerExternalStepUpVerification({
    userId,
    challengeId: stepUp.challengeId,
    deviceId,
    method: verifiedMethod,
    purpose: purpose as OtpPurpose,
    resourceId,
    requestFingerprint,
  });
}

export function pathSegments(pathname: string): string[] {
  try {
    return pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    throw invalidRequest("Path parameter is invalid.");
  }
}

/**
 * Checks whether the given HTTP route requires authentication.
 */
export function isAuthenticatedRoute(
  method: string | undefined,
  segments: readonly string[],
): boolean {
  if (!method) {
    return false;
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "notifications") {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "notifications" &&
    segments[2] === "read"
  ) {
    return true;
  }
  if (
    (method === "GET" && (segments.length === 1 || segments.length === 2) && segments[0] === "anomalies") ||
    (method === "POST" && segments.length === 3 && segments[0] === "anomalies" && segments[2] === "acknowledge")
  ) {
    return true;
  }
  if (
    (method === "POST" && segments.length === 3 && segments[0] === "auth" && segments[1] === "password" && segments[2] === "change") ||
    (method === "GET" && segments.length === 2 && segments[0] === "auth" && segments[1] === "devices") ||
    (method === "DELETE" && segments.length === 3 && segments[0] === "auth" && segments[1] === "devices") ||
    (method === "GET" && segments.length === 3 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "methods") ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "biometric" && segments[3] === "enroll") ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "totp" && (segments[3] === "enroll" || segments[3] === "confirm")) ||
    (method === "DELETE" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "methods") ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recovery-codes" && segments[3] === "rotate") ||
    (method === "POST" && segments.length === 3 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recover") ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "mfa" && segments[2] === "recover" && (segments[3] === "verify" || segments[3] === "complete")) ||
    (method === "POST" && segments.length === 4 && segments[0] === "auth" && segments[1] === "challenges" && segments[3] === "resend")
  ) {
    return true;
  }
  if (
    (method === "GET" && segments.length === 2 && segments[0] === "kyc" && segments[1] === "application") ||
    (method === "POST" && segments.length === 2 && segments[0] === "kyc" && segments[1] === "application") ||
    (method === "POST" && segments.length === 3 && segments[0] === "kyc" && segments[1] === "application" && segments[2] === "submit")
  ) {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    (segments[0] === "internal-recipients" || segments[0] === "external-recipients") &&
    segments[1] === "lookup"
  ) {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "auth" &&
    segments[1] === "otp" &&
    segments[2] === "challenges"
  ) {
    return true;
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "accounts") {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "accounts" &&
    (segments[2] === "number" ||
      segments[2] === "transactions" ||
      segments[2] === "summary" ||
      segments[2] === "statement-export")
  ) {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 4 &&
    segments[0] === "accounts" &&
    segments[2] === "transactions"
  ) {
    return true;
  }
  if (segments[0] === "beneficiaries") {
    return (
      (method === "GET" && (segments.length === 1 || segments.length === 2)) ||
      (method === "POST" && segments.length === 1) ||
      (method === "PATCH" && segments.length === 2) ||
      (method === "DELETE" && segments.length === 2)
    );
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "transfers" && segments[1] === "quote") {
    return true;
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "transfers") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "transfers") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "savings" && segments[1] === "products") {
    return true;
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "cards") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "cards") {
    return true;
  }
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "cards" &&
    (segments[2] === "lock" || segments[2] === "unlock" || segments[2] === "report-lost")
  ) {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "accounts") {
    return true;
  }
  if (
    (method === "GET" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") ||
    (method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "applications") ||
    (method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "applications") ||
    (method === "POST" && segments.length === 4 && segments[0] === "credit" && segments[1] === "applications" && segments[3] === "activate")
  ) {
    return true;
  }
  if (method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "accounts") {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 4 &&
    segments[0] === "credit" &&
    segments[1] === "accounts" &&
    (segments[3] === "transactions" || segments[3] === "statements")
  ) {
    return true;
  }
  if (
    method === "GET" &&
    segments.length === 5 &&
    segments[0] === "credit" &&
    segments[1] === "accounts" &&
    segments[3] === "statements"
  ) {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payment-quotes") {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "credit" && segments[1] === "payments") {
    return true;
  }
  if (method === "GET" && segments.length === 3 && segments[0] === "credit" && segments[1] === "payments") {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "savings" && segments[1] === "quotes") {
    return true;
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "savings" && segments[1] === "deposits") {
    return true;
  }
  if (method === "GET" && segments.length === 2 && segments[0] === "savings" && segments[1] === "deposits") {
    return true;
  }
  if (method === "GET" && segments.length === 3 && segments[0] === "savings" && segments[1] === "openings") {
    return true;
  }
  if (method === "GET" && segments.length === 3 && segments[0] === "savings" && segments[1] === "deposits") {
    return true;
  }
  if (method === "PATCH" && segments.length === 3 && segments[0] === "savings" && segments[1] === "deposits") {
    return true;
  }
  return method === "POST" && segments.length === 4 && segments[0] === "savings" && segments[1] === "deposits" && segments[3] === "withdraw";
}
