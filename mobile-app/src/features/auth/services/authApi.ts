import type {
  AuthChallengeResponse,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  MfaLifecyclePurpose,
  MfaMethodsResponse,
  RecoveryCompletedResponse,
  RecoveryStartedResponse,
  RegisterRequest,
  RegisterResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  TotpConfirmationResponse,
  TotpEnrollmentResponse,
  VerifyAuthChallengeRequest,
} from "@/features/auth/types/auth";
import {
  isAuthChallengeResponse,
  isLoginResponse,
  isMfaMethodsResponse,
  isRecoveryCompletedResponse,
  isRecoveryStartedResponse,
  isRegisterResponse,
  isRegistrationChallengeResponse,
  isRefreshTokenResponse,
  isTotpConfirmationResponse,
  isTotpEnrollmentResponse,
} from "@/features/auth/services/authResponseValidators";
import { requestJson, type RequestAuth } from "@/services/api/httpClient";

function requireNonEmpty(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new TypeError(`${fieldName} không được để trống.`);
  }

  return normalizedValue;
}

export type AuthRequestOptions = {
  deviceId: string;
};

export type AuthenticatedRequestOptions = RequestAuth & {
  accessToken: string;
  deviceId: string;
};

function requireAuthenticated(
  options: AuthenticatedRequestOptions,
): AuthenticatedRequestOptions {
  return {
    ...options,
    accessToken: requireNonEmpty(options.accessToken, "accessToken"),
    deviceId: requireNonEmpty(options.deviceId, "deviceId"),
  };
}

function createDeviceHeaders(
  options: AuthRequestOptions | undefined,
): Record<string, string> {
  return {
    "X-Device-ID": requireNonEmpty(options?.deviceId ?? "", "deviceId"),
  };
}

export function login(
  request: LoginRequest,
  options: AuthRequestOptions,
): Promise<LoginResponse> {
  const body: LoginRequest = {
    email: request.email,
    password: request.password,
  };

  return requestJson<LoginResponse>("/auth/login", {
    method: "POST",
    body,
    headers: createDeviceHeaders(options),
  }, isLoginResponse);
}

export function register(
  request: RegisterRequest,
  options: AuthRequestOptions,
): Promise<AuthChallengeResponse> {
  const body: RegisterRequest = {
    fullName: request.fullName,
    email: request.email,
    phoneNumber: request.phoneNumber,
    password: request.password,
  };

  return requestJson<AuthChallengeResponse>("/auth/register", {
    method: "POST",
    body,
    headers: createDeviceHeaders(options),
  }, isRegistrationChallengeResponse);
}

export function verifyRegistrationChallenge(
  request: VerifyAuthChallengeRequest,
  options: AuthRequestOptions,
): Promise<RegisterResponse> {
  return requestJson<RegisterResponse>(
    "/auth/register/verify",
    {
      method: "POST",
      body: request,
      headers: createDeviceHeaders(options),
    },
    isRegisterResponse,
  );
}

export function resendRegistrationChallenge(
  challengeId: string,
  options: AuthRequestOptions,
): Promise<AuthChallengeResponse> {
  const normalizedChallengeId = requireNonEmpty(challengeId, "challengeId");
  return requestJson<AuthChallengeResponse>(
    `/auth/challenges/${encodeURIComponent(normalizedChallengeId)}/resend`,
    {
      method: "POST",
      body: {},
      headers: createDeviceHeaders(options),
    },
    (payload): payload is AuthChallengeResponse =>
      isRegistrationChallengeResponse(payload),
  );
}

export async function cancelRegistration(
  challengeId: string,
  options: AuthRequestOptions,
): Promise<void> {
  const body = {
    challengeId: requireNonEmpty(challengeId, "challengeId"),
  };

  await requestJson<null>(
    "/auth/register/cancel",
    { method: "POST", body, headers: createDeviceHeaders(options) },
    (payload): payload is null => payload === null,
  );
}

export async function refreshSession(
  refreshToken: string,
  options: AuthRequestOptions,
): Promise<RefreshTokenResponse> {
  const body: RefreshTokenRequest = {
    refreshToken: requireNonEmpty(refreshToken, "refreshToken"),
  };

  return requestJson<RefreshTokenResponse>(
    "/auth/refresh",
    { method: "POST", body, headers: createDeviceHeaders(options) },
    isRefreshTokenResponse,
  );
}

export async function revokeSession(
  refreshToken: string,
  options: AuthRequestOptions,
): Promise<void> {
  const body: LogoutRequest = {
    refreshToken: requireNonEmpty(refreshToken, "refreshToken"),
  };

  await requestJson<null>(
    "/auth/logout",
    { method: "POST", body, headers: createDeviceHeaders(options) },
    (payload): payload is null => payload === null,
  );
}

export async function revokeAllSessions(
  auth: RequestAuth & { accessToken: string; deviceId: string },
): Promise<void> {
  const boundAuth = {
    ...auth,
    accessToken: requireNonEmpty(auth.accessToken, "accessToken"),
    deviceId: requireNonEmpty(auth.deviceId, "deviceId"),
  };
  await requestJson<null>(
    "/auth/logout-all",
    { method: "POST", auth: boundAuth },
    (payload): payload is null => payload === null,
  );
}

export function listMfaMethods(
  options: AuthenticatedRequestOptions,
): Promise<MfaMethodsResponse> {
  return requestJson<MfaMethodsResponse>(
    "/auth/mfa/methods",
    { method: "GET", auth: requireAuthenticated(options) },
    isMfaMethodsResponse,
  );
}

export type BeginTotpEnrollmentRequest = {
  password: string;
  displayName?: string;
  challengeId?: string;
  code?: string;
};

export function beginTotpEnrollment(
  request: BeginTotpEnrollmentRequest,
  options: AuthenticatedRequestOptions,
): Promise<TotpEnrollmentResponse> {
  return requestJson<TotpEnrollmentResponse>(
    "/auth/mfa/totp/enroll",
    { method: "POST", body: request, auth: requireAuthenticated(options) },
    isTotpEnrollmentResponse,
  );
}

export function confirmTotpEnrollment(
  request: { credentialId: string; code: string },
  options: AuthenticatedRequestOptions,
): Promise<TotpConfirmationResponse> {
  return requestJson<TotpConfirmationResponse>(
    "/auth/mfa/totp/confirm",
    { method: "POST", body: request, auth: requireAuthenticated(options) },
    isTotpConfirmationResponse,
  );
}

export function createMfaChallenge(
  request: { purpose: MfaLifecyclePurpose; method?: "TOTP" | "EMAIL_OTP" },
  options: AuthenticatedRequestOptions,
): Promise<AuthChallengeResponse> {
  return requestJson<AuthChallengeResponse>(
    "/auth/otp/challenges",
    { method: "POST", body: request, auth: requireAuthenticated(options) },
    (payload): payload is AuthChallengeResponse =>
      isAuthChallengeResponse(payload) && payload.purpose === request.purpose,
  );
}

export async function revokeMfaMethod(
  credentialId: string,
  request: { password: string; challengeId: string; code: string },
  options: AuthenticatedRequestOptions,
): Promise<void> {
  await requestJson<null>(
    `/auth/mfa/methods/${encodeURIComponent(requireNonEmpty(credentialId, "credentialId"))}`,
    { method: "DELETE", body: request, auth: requireAuthenticated(options) },
    (payload): payload is null => payload === null,
  );
}

export function rotateRecoveryCodes(
  request: { password: string; challengeId: string; code: string },
  options: AuthenticatedRequestOptions,
): Promise<{ status: "ROTATED"; recoveryCodes: string[] }> {
  return requestJson<{ status: "ROTATED"; recoveryCodes: string[] }>(
    "/auth/mfa/recovery-codes/rotate",
    { method: "POST", body: request, auth: requireAuthenticated(options) },
    (payload): payload is { status: "ROTATED"; recoveryCodes: string[] } =>
      typeof payload === "object" && payload !== null &&
      (payload as { status?: unknown }).status === "ROTATED" &&
      Array.isArray((payload as { recoveryCodes?: unknown }).recoveryCodes) &&
      (payload as { recoveryCodes: unknown[] }).recoveryCodes.length >= 8 &&
      (payload as { recoveryCodes: unknown[] }).recoveryCodes.every((code) => typeof code === "string" && code.length >= 16),
  );
}

export function startMfaRecovery(
  request: { email: string; password: string; code: string },
  options: AuthRequestOptions,
): Promise<RecoveryStartedResponse> {
  return requestJson<RecoveryStartedResponse>(
    "/auth/mfa/recover",
    { method: "POST", body: request, headers: createDeviceHeaders(options) },
    isRecoveryStartedResponse,
  );
}

export function completeMfaRecovery(
  recoveryToken: string,
  options: AuthRequestOptions,
): Promise<RecoveryCompletedResponse> {
  return requestJson<RecoveryCompletedResponse>(
    "/auth/mfa/recover/complete",
    {
      method: "POST",
      body: { recoveryToken: requireNonEmpty(recoveryToken, "recoveryToken") },
      headers: createDeviceHeaders(options),
    },
    isRecoveryCompletedResponse,
  );
}

export function beginRecoveryTotpEnrollment(
  request: { recoveryToken: string; displayName?: string },
  options: AuthRequestOptions,
): Promise<TotpEnrollmentResponse> {
  return requestJson<TotpEnrollmentResponse>(
    "/auth/mfa/recover/enroll",
    { method: "POST", body: request, headers: createDeviceHeaders(options) },
    isTotpEnrollmentResponse,
  );
}

export function confirmRecoveryTotpEnrollment(
  request: { recoveryToken: string; credentialId: string; code: string },
  options: AuthRequestOptions,
): Promise<TotpConfirmationResponse> {
  return requestJson<TotpConfirmationResponse>(
    "/auth/mfa/totp/confirm",
    { method: "POST", body: request, headers: createDeviceHeaders(options) },
    isTotpConfirmationResponse,
  );
}

export const authApi = {
  login,
  register,
  verifyRegistrationChallenge,
  resendRegistrationChallenge,
  cancelRegistration,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  listMfaMethods,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  createMfaChallenge,
  revokeMfaMethod,
  rotateRecoveryCodes,
  startMfaRecovery,
  completeMfaRecovery,
  beginRecoveryTotpEnrollment,
  confirmRecoveryTotpEnrollment,
};
