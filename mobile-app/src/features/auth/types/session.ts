import type { AuthUser, LoginResponse } from "@/features/auth/types/auth";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  user: AuthUser;
};

export function createAuthSession(
  loginResponse: LoginResponse,
  now = Date.now(),
): AuthSession {
  if (
    !Number.isFinite(loginResponse.expiresInSeconds) ||
    loginResponse.expiresInSeconds <= 0
  ) {
    throw new RangeError("expiresInSeconds phải là số hữu hạn lớn hơn 0.");
  }

  if (!Number.isFinite(now)) {
    throw new RangeError("now phải là Unix timestamp hợp lệ.");
  }

  const accessTokenExpiresAt = now + loginResponse.expiresInSeconds * 1000;

  if (!Number.isFinite(accessTokenExpiresAt)) {
    throw new RangeError("accessTokenExpiresAt vượt phạm vi hợp lệ.");
  }

  return {
    accessToken: loginResponse.accessToken,
    refreshToken: loginResponse.refreshToken,
    accessTokenExpiresAt,
    user: loginResponse.user,
  };
}

export function isAccessTokenExpired(
  session: AuthSession,
  now = Date.now(),
): boolean {
  return now >= session.accessTokenExpiresAt;
}
