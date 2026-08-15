import type {
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
  deviceId?: string;
};

function createDeviceHeaders(
  options: AuthRequestOptions,
): Record<string, string> | undefined {
  const deviceId = options.deviceId?.trim();
  return deviceId ? { "X-Device-ID": deviceId } : undefined;
}

export function login(
  request: LoginRequest,
  options: AuthRequestOptions = {},
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
    isLoginResponse(payload) || isAuthChallengeResponse(payload));
}

export function verifyLoginChallenge(
  request: VerifyAuthChallengeRequest,
  options: AuthRequestOptions = {},
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
  options: AuthRequestOptions = {},
): Promise<RegisterResponse> {
  const body: RegisterRequest = {
    fullName: request.fullName,
    email: request.email,
    phoneNumber: request.phoneNumber,
    password: request.password,
  };

  return requestJson<RegisterResponse>("/auth/register", {
    method: "POST",
    body,
    headers: createDeviceHeaders(options),
  }, isRegisterResponse);
}

export async function refreshSession(
  refreshToken: string,
  options: AuthRequestOptions = {},
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
  options: AuthRequestOptions = {},
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

export async function revokeAllSessions(auth: RequestAuth): Promise<void> {
  await requestJson<null>(
    "/auth/logout-all",
    { method: "POST", auth },
    (payload): payload is null => payload === null,
  );
}

export const authApi = {
  login,
  verifyLoginChallenge,
  register,
  refreshSession,
  revokeSession,
  revokeAllSessions,
};
