import { ApiError } from "@/services/api/ApiError";
import {
  isTotpNotEnrolledError,
  TOTP_NOT_ENROLLED_MESSAGE,
} from "@/features/auth/utils/totpError";

describe("totpError utility", () => {
  it("exports a friendly Vietnamese notice message", () => {
    expect(TOTP_NOT_ENROLLED_MESSAGE).toContain("Google Authenticator");
    expect(TOTP_NOT_ENROLLED_MESSAGE).toContain("TOTP");
  });

  it("recognizes ApiError with MFA_NOT_ENROLLED or MFA_REQUIRED code", () => {
    const error1 = new ApiError({
      status: 403,
      code: "MFA_NOT_ENROLLED",
      message: "Forbidden",
    });
    const error2 = new ApiError({
      status: 401,
      code: "MFA_REQUIRED",
      message: "Step-up required",
    });
    expect(isTotpNotEnrolledError(error1)).toBe(true);
    expect(isTotpNotEnrolledError(error2)).toBe(true);
  });

  it("recognizes standard English and Vietnamese backend error messages", () => {
    expect(isTotpNotEnrolledError(new Error("MFA credential is not active."))).toBe(true);
    expect(isTotpNotEnrolledError(new Error("mfa credential not found"))).toBe(true);
    expect(
      isTotpNotEnrolledError(
        new Error(
          "Tài khoản chưa kích hoạt Google Authenticator (TOTP). Vui lòng cài đặt trong mục Cài đặt bảo mật trước khi chuyển tiền.",
        ),
      ),
    ).toBe(true);
    expect(isTotpNotEnrolledError("Chưa kích hoạt TOTP")).toBe(true);
  });

  it("returns false for unrelated errors or null", () => {
    expect(isTotpNotEnrolledError(null)).toBe(false);
    expect(isTotpNotEnrolledError(undefined)).toBe(false);
    expect(isTotpNotEnrolledError(new Error("Network connection lost"))).toBe(false);
    expect(isTotpNotEnrolledError(new Error("Số dư không đủ"))).toBe(false);
  });
});
