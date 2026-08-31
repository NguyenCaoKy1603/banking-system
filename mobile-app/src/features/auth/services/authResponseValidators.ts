import type {
  AuthChallengeResponse,
  LoginResponse,
  MfaCredentialSummary,
  MfaMethodsResponse,
  RecoveryCompletedResponse,
  RecoveryStartedResponse,
  RegisterResponse,
  RefreshTokenResponse,
  TotpConfirmationResponse,
  TotpEnrollmentResponse,
} from "@/features/auth/types/auth";
import { isAuthUser } from "@/features/auth/validation/authDataValidators";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isLoginResponse(payload: unknown): payload is LoginResponse {
  return (
    isRecord(payload) &&
    typeof payload.accessToken === "string" &&
    payload.accessToken.trim().length > 0 &&
    typeof payload.refreshToken === "string" &&
    payload.refreshToken.trim().length > 0 &&
    typeof payload.expiresInSeconds === "number" &&
    Number.isFinite(payload.expiresInSeconds) &&
    payload.expiresInSeconds > 0 &&
    isAuthUser(payload.user)
  );
}

function isAuthChallengeMethod(value: unknown): value is "OTP" | "EMAIL_OTP" | "TOTP" | "BIOMETRIC" {
  return value === "OTP" || value === "EMAIL_OTP" || value === "TOTP" || value === "BIOMETRIC";
}

function isAuthChallengePurpose(
  value: unknown,
): value is AuthChallengeResponse["purpose"] {
  return [
    "REGISTRATION_VERIFY",
    "REGISTRATION_EMAIL_VERIFY",
    "LOGIN",
    "TRANSFER",
    "SAVINGS_OPENING",
    "CREDIT_APPLICATION",
    "CARD_ACTIVATION",
    "CREDIT_PAYMENT",
    "CARD_UNLOCK",
    "CARD_REPORT_LOST",
    "RECOVERY_CODE_ROTATION",
    "MFA_FACTOR_CHANGE",
    "MFA_FACTOR_REMOVAL",
  ].includes(value as AuthChallengeResponse["purpose"]);
}

export function isAuthChallengeResponse(
  payload: unknown,
): payload is AuthChallengeResponse {
  const record = isRecord(payload) ? payload : null;
  const methods = record?.methods;
  const selectedMethod = record?.method;
  return (
    record !== null &&
    typeof record.challengeId === "string" &&
    record.challengeId.trim().length > 0 &&
    isNonEmptyDateTime(record.expiresAt) &&
    isAuthChallengePurpose(record.purpose) &&
    Array.isArray(methods) &&
    methods.length > 0 &&
    methods.every(isAuthChallengeMethod) &&
    (selectedMethod === undefined || isAuthChallengeMethod(selectedMethod)) &&
    (record.resendAfter === undefined || isNonEmptyDateTime(record.resendAfter)) &&
    (record.maskedDestination === undefined || (
      typeof record.maskedDestination === "string" &&
      record.maskedDestination.trim().length > 0
    ))
  );
}

export function isRefreshTokenResponse(
  payload: unknown,
): payload is RefreshTokenResponse {
  return isLoginResponse(payload);
}

export function isRegisterResponse(payload: unknown): payload is RegisterResponse {
  return isRecord(payload) && isAuthUser(payload.user);
}

export function isRegistrationChallengeResponse(
  payload: unknown,
): payload is AuthChallengeResponse {
  return (
    isAuthChallengeResponse(payload) &&
    (payload.purpose === "REGISTRATION_VERIFY" ||
      payload.purpose === "REGISTRATION_EMAIL_VERIFY") &&
    (payload.methods.includes("OTP") || payload.methods.includes("EMAIL_OTP"))
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isMfaCredentialSummary(value: unknown): value is MfaCredentialSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && value.id.trim().length > 0 &&
    typeof value.customerId === "string" && value.customerId.trim().length > 0 &&
    (value.credentialType === "TOTP" || value.credentialType === "PASSKEY" || value.credentialType === "OOB_SMS") &&
    typeof value.displayName === "string" &&
    (value.status === "PENDING" || value.status === "ACTIVE" || value.status === "SUSPENDED" || value.status === "REVOKED") &&
    typeof value.algorithm === "string" &&
    typeof value.digits === "number" && Number.isInteger(value.digits) &&
    typeof value.periodSeconds === "number" && Number.isInteger(value.periodSeconds) &&
    (value.lastAcceptedTimeStep === null || typeof value.lastAcceptedTimeStep === "number") &&
    isNullableString(value.enrolledAt) &&
    isNullableString(value.lastUsedAt) &&
    isNullableString(value.revokedAt) &&
    isNullableString(value.compromisedAt) &&
    isNonEmptyDateTime(value.createdAt)
  );
}

export function isMfaMethodsResponse(payload: unknown): payload is MfaMethodsResponse {
  return isRecord(payload) && Array.isArray(payload.items) && payload.items.every(isMfaCredentialSummary);
}

export function isTotpEnrollmentResponse(payload: unknown): payload is TotpEnrollmentResponse {
  return (
    isRecord(payload) &&
    typeof payload.credentialId === "string" && payload.credentialId.trim().length > 0 &&
    payload.status === "PENDING" &&
    isNonEmptyDateTime(payload.expiresAt) &&
    typeof payload.manualSetupKey === "string" && payload.manualSetupKey.trim().length > 0 &&
    typeof payload.otpauthUri === "string" && payload.otpauthUri.startsWith("otpauth://")
  );
}

export function isTotpConfirmationResponse(payload: unknown): payload is TotpConfirmationResponse {
  return (
    isRecord(payload) &&
    typeof payload.credentialId === "string" && payload.credentialId.trim().length > 0 &&
    payload.status === "ACTIVE" &&
    Array.isArray(payload.recoveryCodes) &&
    payload.recoveryCodes.length >= 8 &&
    payload.recoveryCodes.every((code) => typeof code === "string" && code.trim().length >= 16)
  );
}

export function isRecoveryStartedResponse(payload: unknown): payload is RecoveryStartedResponse {
  return (
    isRecord(payload) &&
    payload.status === "RECOVERY_STARTED" &&
    typeof payload.recoveryRequestId === "string" && payload.recoveryRequestId.trim().length > 0 &&
    typeof payload.recoveryToken === "string" && payload.recoveryToken.trim().length > 0 &&
    isNonEmptyDateTime(payload.cooldownUntil)
  );
}

export function isRecoveryCompletedResponse(payload: unknown): payload is RecoveryCompletedResponse {
  return isRecord(payload) && payload.status === "RECOVERY_COMPLETED";
}
