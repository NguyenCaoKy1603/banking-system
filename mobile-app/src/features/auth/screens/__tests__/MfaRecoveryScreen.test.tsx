import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { MfaRecoveryScreen } from "@/features/auth/screens/MfaRecoveryScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as authApi from "@/features/auth/services/authApi";
import { ApiError } from "@/services/api/ApiError";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("react-native-qrcode-svg", () => "QRCode");

jest.mock("@/features/auth/services/authApi");

const useAuthMock = jest.mocked(useAuth);
const startMfaRecoveryMock = jest.mocked(authApi.startMfaRecovery);
const completeMfaRecoveryMock = jest.mocked(authApi.completeMfaRecovery);
const beginRecoveryTotpEnrollmentMock = jest.mocked(authApi.beginRecoveryTotpEnrollment);
const confirmRecoveryTotpEnrollmentMock = jest.mocked(authApi.confirmRecoveryTotpEnrollment);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const syntheticRecoveryCodes = [
  "code-synth-000000000001",
  "code-synth-000000000002",
  "code-synth-000000000003",
  "code-synth-000000000004",
  "code-synth-000000000005",
  "code-synth-000000000006",
  "code-synth-000000000007",
  "code-synth-000000000008",
  "code-synth-000000000009",
  "code-synth-000000000010",
];

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

function findByTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAllByProps({ testID });
}

describe("MfaRecoveryScreen — Recovery codes display after recovery confirmation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      deviceId: "device-test-uuid",
      session: null,
      status: "anonymous",
      isAuthenticated: false,
      pendingRecoveryCodes: null,
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      cancelRegistration: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
      refreshAccessToken: jest.fn(),
      logoutNotice: null,
    });
  });

  async function driveToStepThree(renderer: ReactTestRenderer) {
    // Step 1: fill email, password, recovery code and start
    startMfaRecoveryMock.mockResolvedValueOnce({
      recoveryRequestId: "req-1",
      recoveryToken: "token-secret-recovery",
      status: "RECOVERY_STARTED",
      cooldownUntil: new Date(Date.now() - 5000).toISOString(), // Cooldown already expired
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-email").props.onChangeText("tester@example.test");
      byTestId(renderer, "mfa-recovery-password").props.onChangeText("Password1");
      byTestId(renderer, "mfa-recovery-code").props.onChangeText("code-1234567890123456");
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-start").props.onPress();
    });

    // Step 2: Cooldown step -> press approve
    completeMfaRecoveryMock.mockResolvedValueOnce({ status: "RECOVERY_COMPLETED" });
    beginRecoveryTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-test-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      manualSetupKey: "JBSWY3DPEHPK3PXP",
      otpauthUri: "otpauth://totp/Bank:tester?secret=JBSWY3DPEHPK3PXP",
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-approve").props.onPress();
    });
  }

  it("hiển thị 10 mã khôi phục mới và không điều hướng Login khi confirm thành công", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MfaRecoveryScreen />);
    });

    await driveToStepThree(renderer);

    // Step 3 is active: TOTP input and confirm button exist
    expect(findByTestId(renderer, "mfa-recovery-totp").length).toBeGreaterThan(0);
    expect(findByTestId(renderer, "mfa-recovery-confirm").length).toBeGreaterThan(0);
    expect(findByTestId(renderer, "mfa-recovery-codes").length).toBe(0);

    // Mock confirmation success returning 10 recovery codes
    confirmRecoveryTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-test-1",
      status: "ACTIVE",
      recoveryCodes: syntheticRecoveryCodes,
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-totp").props.onChangeText("123456");
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-confirm").props.onPress();
    });

    // 1. Assert confirm was called with correct payload
    expect(confirmRecoveryTotpEnrollmentMock).toHaveBeenCalledWith(
      {
        recoveryToken: "token-secret-recovery",
        credentialId: "cred-test-1",
        code: "123456",
      },
      { deviceId: "device-test-uuid" },
    );

    // 2. Assert router.replace was NOT called immediately
    expect(mockReplace).not.toHaveBeenCalled();

    // 3. Assert recovery codes card is rendered with all 10 codes
    const codesElements = findByTestId(renderer, "mfa-recovery-codes");
    expect(codesElements.length).toBeGreaterThan(0);
    const codesTextNode = codesElements.find((node) => node.props.children === syntheticRecoveryCodes.join("\n"));
    expect(codesTextNode).toBeDefined();

    // 4. Assert acknowledgement button is present
    expect(findByTestId(renderer, "mfa-recovery-done").length).toBeGreaterThan(0);

    // 5. Assert old form inputs and confirm button are unmounted
    expect(findByTestId(renderer, "mfa-recovery-totp").length).toBe(0);
    expect(findByTestId(renderer, "mfa-recovery-confirm").length).toBe(0);
  });

  it("điều hướng về Login và dọn sạch recovery codes sau khi người dùng xác nhận đã lưu", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MfaRecoveryScreen />);
    });

    await driveToStepThree(renderer);

    confirmRecoveryTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-test-1",
      status: "ACTIVE",
      recoveryCodes: syntheticRecoveryCodes,
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-totp").props.onChangeText("654321");
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-confirm").props.onPress();
    });

    expect(findByTestId(renderer, "mfa-recovery-codes").length).toBeGreaterThan(0);

    // User acknowledges saving the codes
    await act(async () => {
      byTestId(renderer, "mfa-recovery-done").props.onPress();
    });

    // 1. Assert navigation to login occurred
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/login");

    // 2. Assert recovery codes view is closed/cleared
    expect(findByTestId(renderer, "mfa-recovery-codes").length).toBe(0);
  });

  it("không hiển thị recovery codes và không điều hướng khi confirm thất bại, cho phép thử lại", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MfaRecoveryScreen />);
    });

    await driveToStepThree(renderer);

    confirmRecoveryTotpEnrollmentMock.mockRejectedValueOnce(
      new ApiError({ status: 401, code: "UNAUTHORIZED", message: "Mã TOTP không hợp lệ." }),
    );

    await act(async () => {
      byTestId(renderer, "mfa-recovery-totp").props.onChangeText("000000");
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-confirm").props.onPress();
    });

    // 1. Assert router.replace was not called
    expect(mockReplace).not.toHaveBeenCalled();

    // 2. Assert recovery codes are NOT displayed
    expect(findByTestId(renderer, "mfa-recovery-codes").length).toBe(0);
    expect(findByTestId(renderer, "mfa-recovery-done").length).toBe(0);

    // 3. Assert step 3 form remains active for retry
    expect(findByTestId(renderer, "mfa-recovery-totp").length).toBeGreaterThan(0);
    expect(findByTestId(renderer, "mfa-recovery-confirm").length).toBeGreaterThan(0);

    // User re-enters valid code and retries
    confirmRecoveryTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-test-1",
      status: "ACTIVE",
      recoveryCodes: syntheticRecoveryCodes,
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-totp").props.onChangeText("111222");
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-confirm").props.onPress();
    });

    // Now recovery codes are shown
    expect(findByTestId(renderer, "mfa-recovery-codes").length).toBeGreaterThan(0);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("từ chối mã TOTP không đủ 6 chữ số trước khi gọi network", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<MfaRecoveryScreen />);
    });

    await driveToStepThree(renderer);

    await act(async () => {
      byTestId(renderer, "mfa-recovery-totp").props.onChangeText("123");
    });

    await act(async () => {
      byTestId(renderer, "mfa-recovery-confirm").props.onPress();
    });

    expect(confirmRecoveryTotpEnrollmentMock).not.toHaveBeenCalled();
    expect(findByTestId(renderer, "mfa-recovery-codes").length).toBe(0);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
