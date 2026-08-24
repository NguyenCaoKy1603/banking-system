import type {
  AuthChallengeResponse,
  LoginResponse,
  RegisterResponse,
  RefreshTokenResponse,
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

function isAuthChallengeMethod(value: unknown): value is "OTP" | "BIOMETRIC" {
  return value === "OTP" || value === "BIOMETRIC";
}

function isAuthChallengePurpose(
  value: unknown,
): value is AuthChallengeResponse["purpose"] {
  return [
    "REGISTRATION_VERIFY",
    "LOGIN",
    "TRANSFER",
    "SAVINGS_OPENING",
    "CREDIT_APPLICATION",
    "CARD_ACTIVATION",
    "CREDIT_PAYMENT",
    "CARD_UNLOCK",
  ].includes(value as AuthChallengeResponse["purpose"]);
}

export function isAuthChallengeResponse(
  payload: unknown,
): payload is AuthChallengeResponse {
  return (
    isRecord(payload) &&
    typeof payload.challengeId === "string" &&
    payload.challengeId.trim().length > 0 &&
    isNonEmptyDateTime(payload.expiresAt) &&
    isAuthChallengePurpose(payload.purpose) &&
    Array.isArray(payload.methods) &&
    payload.methods.length > 0 &&
    payload.methods.every(isAuthChallengeMethod)
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
    payload.purpose === "REGISTRATION_VERIFY" &&
    payload.methods.includes("OTP")
  );
}
