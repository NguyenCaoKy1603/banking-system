import * as LocalAuthentication from "expo-local-authentication";

import {
  createDeviceBoundBiometricAssertion,
  getDeviceBoundAssertion,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";

jest.mock("expo-local-authentication", () => ({
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC_WEAK: 2,
    BIOMETRIC_STRONG: 3,
  },
  authenticateAsync: jest.fn(),
  getEnrolledLevelAsync: jest.fn(),
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
}));

const mockedLocalAuthentication = jest.mocked(LocalAuthentication);

describe("biometricAuth", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("từ chối khi thiết bị không có phần cứng sinh trắc học và chưa đặt mã PIN", async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(false);
    mockedLocalAuthentication.getEnrolledLevelAsync.mockResolvedValue(
      LocalAuthentication.SecurityLevel.NONE,
    );

    await expect(
      requestBiometricAuthentication("Xác thực"),
    ).rejects.toThrow("Thiết bị chưa sẵn sàng");
    expect(mockedLocalAuthentication.isEnrolledAsync).not.toHaveBeenCalled();
  });

  it("từ chối khi chưa có sinh trắc học và chưa có mã PIN thiết bị", async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
    mockedLocalAuthentication.getEnrolledLevelAsync.mockResolvedValue(
      LocalAuthentication.SecurityLevel.NONE,
    );

    await expect(
      requestBiometricAuthentication("Xác thực"),
    ).rejects.toThrow("Thiết bị chưa sẵn sàng");
    expect(mockedLocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
  });

  it("cho phép xác thực bằng mã PIN thiết bị khi chưa enroll vân tay/khuôn mặt", async () => {
    mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
    mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
    mockedLocalAuthentication.getEnrolledLevelAsync.mockResolvedValue(
      LocalAuthentication.SecurityLevel.SECRET,
    );
    mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
      success: true,
    });

    await expect(
      requestBiometricAuthentication("Xác thực bằng PIN"),
    ).resolves.toBeUndefined();
    expect(mockedLocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
      cancelLabel: "Hủy",
      promptMessage: "Xác thực bằng PIN",
    });
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

  it("không lấy hoặc tự tạo device proof từ public bundle", () => {
    expect(getDeviceBoundAssertion()).toBe("");
  });

  it("ký challenge sinh trắc học theo ngữ cảnh thiết bị khớp SHA-256 chuẩn", () => {
    const assertionA = createDeviceBoundBiometricAssertion({
      biometricSecret: "secret-123",
      challengeId: "challenge-456",
      deviceId: "device-789",
      purpose: "TRANSFER",
      resourceId: "quote-001",
    });
    const assertionB = createDeviceBoundBiometricAssertion({
      biometricSecret: "secret-123",
      challengeId: "challenge-456",
      deviceId: "device-other",
      purpose: "TRANSFER",
      resourceId: "quote-001",
    });

    expect(assertionA).toMatch(/^biometric-v1\.[0-9a-f]{64}$/);
    expect(assertionA).toBe(
      "biometric-v1.dc23c22fa1481e66d0671091550c5f9bea2771a707bec853bc9e76e84e71d5ac",
    );
    expect(assertionB).not.toBe(assertionA);
  });
});
