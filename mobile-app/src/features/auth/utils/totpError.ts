import { ApiError } from "@/services/api/ApiError";

export const TOTP_NOT_ENROLLED_MESSAGE =
  "Tài khoản của bạn chưa kích hoạt mã bảo mật TOTP (Google Authenticator). Vui lòng thiết lập TOTP để thực hiện giao dịch này.";

export function isTotpNotEnrolledError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof ApiError) {
    if (error.code === "MFA_NOT_ENROLLED" || error.code === "MFA_REQUIRED") {
      return true;
    }
  }

  const message = (
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String((error as { message?: unknown })?.message ?? "")
  ).toLowerCase();

  return (
    message.includes("mfa credential is not active") ||
    message.includes("chưa kích hoạt google authenticator") ||
    message.includes("chưa kích hoạt totp") ||
    message.includes("chưa cài đặt totp") ||
    message.includes("mfa_not_enrolled") ||
    message.includes("mfa credential not found")
  );
}
