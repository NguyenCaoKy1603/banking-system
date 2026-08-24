import type {
  AuthChallengeResponse,
  LoginRequest,
  LoginResponse,
  LoginResult,
  LogoutRequest,
  RegisterRequest,
  RegisterResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  VerifyAuthChallengeRequest,
} from "@/features/auth/types/auth";
import {
  isAuthChallengeResponse,
  isLoginResponse,
  isRegisterResponse,
  isRegistrationChallengeResponse,
  isRefreshTokenResponse,
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
): Promise<LoginResult> {
  const body: LoginRequest = {
    email: request.email,
    password: request.password,
  };

  return requestJson<LoginResult>("/auth/login", {
    method: "POST",
    body,
    headers: createDeviceHeaders(options),
  }, (payload): payload is LoginResult =>
    isLoginResponse(payload) ||
    (isAuthChallengeResponse(payload) && payload.purpose === "LOGIN"));
}

export function verifyLoginChallenge(
  request: VerifyAuthChallengeRequest,
  options: AuthRequestOptions,
): Promise<LoginResponse> {
  return requestJson<LoginResponse>(
    "/auth/verify",
    {
      method: "POST",
      body: request,
      headers: createDeviceHeaders(options),
    },
    isLoginResponse,
  );
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

export const authApi = {
  login,
  verifyLoginChallenge,
  register,
  verifyRegistrationChallenge,
  refreshSession,
  revokeSession,
  revokeAllSessions,
};
