import * as LocalAuthentication from "expo-local-authentication";

import {
  getSandboxBiometricProof,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";

jest.mock("expo-local-authentication", () => ({
  authenticateAsync: jest.fn(),
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
}));

const mockedLocalAuthentication = jest.mocked(LocalAuthentication);

describe("biometricAuth", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.EXPO_PUBLIC_SANDBOX_BIOMETRIC_PROOF;
  });

  it("từ chối khi thiết bị không có phần cứng sinh trắc học", async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(false);

    await expect(
      requestBiometricAuthentication("Xác thực"),
    ).rejects.toThrow("Thiết bị chưa sẵn sàng");
    expect(mockedLocalAuthentication.isEnrolledAsync).not.toHaveBeenCalled();
  });

  it("từ chối khi chưa có dữ liệu sinh trắc học được enroll", async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);

    await expect(
      requestBiometricAuthentication("Xác thực"),
    ).rejects.toThrow("Thiết bị chưa sẵn sàng");
    expect(mockedLocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
  });

  it("gọi native prompt và hoàn tất khi xác thực thành công", async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(true);
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: true,
    });

    await expect(
      requestBiometricAuthentication("Xác thực giao dịch"),
    ).resolves.toBeUndefined();
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
      cancelLabel: "Hủy",
      promptMessage: "Xác thực giao dịch",
    });
  });

  it("trả lỗi an toàn khi native prompt thất bại", async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(true);
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: "user_cancel",
    });

    await expect(
      requestBiometricAuthentication("Xác thực"),
    ).rejects.toThrow("Xác thực sinh trắc học chưa thành công");
  });

  it("đọc sandbox proof từ biến môi trường khi được cấu hình", () => {
    process.env.EXPO_PUBLIC_SANDBOX_BIOMETRIC_PROOF = "provider-assertion";

    expect(getSandboxBiometricProof()).toBe("provider-assertion");
  });

  it("không đóng gói proof tĩnh vào bản production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.EXPO_PUBLIC_SANDBOX_BIOMETRIC_PROOF = "must-not-leak";
    try {
      expect(getSandboxBiometricProof()).toBe("");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
