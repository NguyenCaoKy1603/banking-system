import type {
  AuthUser,
  LoginResponse,
  RegisterResponse,
} from "@/features/auth/types/auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAuthUser(payload: unknown): payload is AuthUser {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    typeof payload.fullName === "string" &&
    typeof payload.email === "string" &&
    typeof payload.phoneNumber === "string" &&
    typeof payload.createdAt === "string"
  );
}

export function isLoginResponse(payload: unknown): payload is LoginResponse {
  return (
    isRecord(payload) &&
    typeof payload.accessToken === "string" &&
    typeof payload.refreshToken === "string" &&
    typeof payload.expiresInSeconds === "number" &&
    Number.isFinite(payload.expiresInSeconds) &&
    isAuthUser(payload.user)
  );
}

export function isRegisterResponse(payload: unknown): payload is RegisterResponse {
  return isRecord(payload) && isAuthUser(payload.user);
}
