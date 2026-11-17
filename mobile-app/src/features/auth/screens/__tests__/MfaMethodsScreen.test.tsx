import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { MfaMethodsScreen } from "@/features/auth/screens/MfaMethodsScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as authApi from "@/features/auth/services/authApi";
import { clearPendingTotpEnrollment } from "@/features/auth/storage/mfaEnrollmentMemoryCache";
import type { TotpEnrollmentResponse } from "@/features/auth/types/auth";
import { ApiError } from "@/services/api/ApiError";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ back: mockBack }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("react-native-qrcode-svg", () => "QRCode");

jest.mock("@/features/auth/services/authApi");

const useAuthMock = jest.mocked(useAuth);
const listMfaMethodsMock = jest.mocked(authApi.listMfaMethods);
const beginTotpEnrollmentMock = jest.mocked(authApi.beginTotpEnrollment);
const confirmTotpEnrollmentMock = jest.mocked(authApi.confirmTotpEnrollment);
const createMfaChallengeMock = jest.mocked(authApi.createMfaChallenge);
const rotateRecoveryCodesMock = jest.mocked(authApi.rotateRecoveryCodes);
const revokeMfaMethodMock = jest.mocked(authApi.revokeMfaMethod);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockSession = {
  accessToken: "access-token-active",
  refreshToken: "refresh-token-active",
  accessTokenExpiresAt: Date.now() + 900_000,
  sessionEpoch: "epoch-1",
  user: {
    id: "customer-1",
    fullName: "Nguyễn Văn A",
    email: "vana@example.com",
    phoneNumber: "0901234567",
    createdAt: "2026-01-01T00:00:00Z",
  },
};

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

const mockCompleteMfaRevocation = jest.fn();
let currentRenderer: ReactTestRenderer | null = null;

function getTextInput(renderer: ReactTestRenderer, testID: string) {
  const nodes = renderer.root.findAllByProps({ testID });
  const input = nodes.find((node) => typeof node.props.onChangeText === "function");
  if (!input) {
    throw new Error(`TextInput not found for testID: ${testID}`);
  }
  return input;
}

function hasTextInput(renderer: ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAllByProps({ testID }).some(
    (node) => typeof node.props.onChangeText === "function",
  );
}

function getButton(renderer: ReactTestRenderer, testID: string) {
  const nodes = renderer.root.findAllByProps({ testID });
  const button = nodes.find((node) => typeof node.props.onPress === "function");
  if (!button) {
    throw new Error(`Button not found for testID: ${testID}`);
  }
  return button;
}

async function renderScreen() {
  await act(async () => {
    currentRenderer = create(<MfaMethodsScreen />);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return currentRenderer!;
}

describe("MfaMethodsScreen — Post-revocation flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPendingTotpEnrollment();
    useAuthMock.mockReturnValue({
      deviceId: "device-test-uuid",
      session: mockSession,
      status: "authenticated",
      isAuthenticated: true,
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: mockCompleteMfaRevocation,
      clearPendingRecoveryCodes: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });
    listMfaMethodsMock.mockResolvedValue({ items: [] });
    mockCompleteMfaRevocation.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearPendingTotpEnrollment();
    if (currentRenderer) {
      act(() => {
        currentRenderer?.unmount();
      });
      currentRenderer = null;
    }
  });

  test("confirmTotpEnrollment success calls completeMfaRevocation with recoveryCodes and does not reload credentials", async () => {
    beginTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-new-1",
      manualSetupKey: "SETUPKEY123",
      otpauthUri: "otpauth://totp/NOVA:user?secret=SETUPKEY123",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    confirmTotpEnrollmentMock.mockResolvedValueOnce({
      status: "ACTIVE",
      credentialId: "cred-new-1",
      recoveryCodes: syntheticRecoveryCodes,
    });

    const renderer = await renderScreen();

    // Enter password and begin enrollment
    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    expect(beginTotpEnrollmentMock).toHaveBeenCalledTimes(1);

    // Initial loadCredentials was called once on mount
    expect(listMfaMethodsMock).toHaveBeenCalledTimes(1);
    listMfaMethodsMock.mockClear();

    // Enter 6-digit confirmation code
    const codeInput = getTextInput(renderer, "mfa-enroll-code");
    await act(async () => {
      codeInput.props.onChangeText("123456");
    });

    const confirmBtn = getButton(renderer, "mfa-enroll-confirm");
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(confirmTotpEnrollmentMock).toHaveBeenCalledTimes(1);
    expect(mockCompleteMfaRevocation).toHaveBeenCalledTimes(1);
    expect(mockCompleteMfaRevocation).toHaveBeenCalledWith({
      recoveryCodes: syntheticRecoveryCodes,
    });

    // Crucial: loadCredentials must NOT be called again after mutation
    expect(listMfaMethodsMock).not.toHaveBeenCalled();
  });

  test("rotateRecoveryCodes success calls completeMfaRevocation with rotated codes and does not reload credentials", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "challenge-rotate-1",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      method: "TOTP",
      methods: ["TOTP"],
      purpose: "RECOVERY_CODE_ROTATION",
    });
    rotateRecoveryCodesMock.mockResolvedValueOnce({
      status: "ROTATED",
      recoveryCodes: syntheticRecoveryCodes,
    });

    const renderer = await renderScreen();

    // Enter password
    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    // Press rotate button
    const rotateBtn = getButton(renderer, "mfa-recovery-rotate");
    await act(async () => {
      await rotateBtn.props.onPress();
    });

    expect(createMfaChallengeMock).toHaveBeenCalledTimes(1);
    listMfaMethodsMock.mockClear();

    // Enter challenge OTP
    const challengeInput = getTextInput(renderer, "mfa-lifecycle-code");
    await act(async () => {
      challengeInput.props.onChangeText("654321");
    });

    const confirmBtn = getButton(renderer, "mfa-lifecycle-confirm");
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(rotateRecoveryCodesMock).toHaveBeenCalledTimes(1);
    expect(mockCompleteMfaRevocation).toHaveBeenCalledTimes(1);
    expect(mockCompleteMfaRevocation).toHaveBeenCalledWith({
      recoveryCodes: syntheticRecoveryCodes,
    });
    expect(listMfaMethodsMock).not.toHaveBeenCalled();
  });

  test("revokeMfaMethod (remove factor) success calls completeMfaRevocation with notice and no recoveryCodes", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "challenge-remove-1",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      method: "TOTP",
      methods: ["TOTP"],
      purpose: "MFA_FACTOR_REMOVAL",
    });
    revokeMfaMethodMock.mockResolvedValueOnce(undefined);

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const removeBtn = getButton(renderer, "mfa-remove-cred-active-1");
    await act(async () => {
      await removeBtn.props.onPress();
    });

    expect(createMfaChallengeMock).toHaveBeenCalledTimes(1);
    listMfaMethodsMock.mockClear();

    const challengeInput = getTextInput(renderer, "mfa-lifecycle-code");
    await act(async () => {
      challengeInput.props.onChangeText("654321");
    });

    const confirmBtn = getButton(renderer, "mfa-lifecycle-confirm");
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(revokeMfaMethodMock).toHaveBeenCalledTimes(1);
    expect(mockCompleteMfaRevocation).toHaveBeenCalledTimes(1);
    expect(mockCompleteMfaRevocation).toHaveBeenCalledWith({
      notice: "Phương thức Authenticator đã được thu hồi. Vui lòng đăng nhập lại.",
    });
    expect(listMfaMethodsMock).not.toHaveBeenCalled();
  });

  test("revokeMfaMethod can switch to Email OTP when authenticator is lost", async () => {
    listMfaMethodsMock.mockResolvedValueOnce({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "chal-remove-totp",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      methods: ["TOTP", "EMAIL_OTP"],
      method: "TOTP",
      purpose: "MFA_FACTOR_REMOVAL",
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "chal-remove-email",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      methods: ["EMAIL_OTP"],
      method: "EMAIL_OTP",
      purpose: "MFA_FACTOR_REMOVAL",
      maskedDestination: "v***@example.com",
    });
    revokeMfaMethodMock.mockResolvedValueOnce(undefined);

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const removeBtn = getButton(renderer, "mfa-remove-cred-active-1");
    await act(async () => {
      await removeBtn.props.onPress();
    });

    expect(createMfaChallengeMock).toHaveBeenCalledWith(
      { purpose: "MFA_FACTOR_REMOVAL", method: undefined },
      expect.anything(),
    );

    // Click switch to Email OTP
    const switchBtn = getButton(renderer, "mfa-switch-email-otp");
    await act(async () => {
      await switchBtn.props.onPress();
    });

    expect(createMfaChallengeMock).toHaveBeenCalledWith(
      { purpose: "MFA_FACTOR_REMOVAL", method: "EMAIL_OTP" },
      expect.anything(),
    );

    const challengeInput = getTextInput(renderer, "mfa-lifecycle-code");
    await act(async () => {
      challengeInput.props.onChangeText("112233");
    });

    const confirmBtn = getButton(renderer, "mfa-lifecycle-confirm");
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(revokeMfaMethodMock).toHaveBeenCalledWith(
      "cred-active-1",
      {
        password: "SecretPass123!",
        challengeId: "chal-remove-email",
        code: "112233",
      },
      expect.anything(),
    );
    expect(mockCompleteMfaRevocation).toHaveBeenCalledTimes(1);
  });

  test("confirmTotpEnrollment failure displays error and does not call completeMfaRevocation", async () => {
    beginTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-fail-1",
      manualSetupKey: "KEYFAIL123",
      otpauthUri: "otpauth://totp/NOVA:user?secret=KEYFAIL123",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    confirmTotpEnrollmentMock.mockRejectedValueOnce(
      new ApiError({ status: 401, code: "UNAUTHORIZED", message: "Mã TOTP không hợp lệ." }),
    );

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    const codeInput = getTextInput(renderer, "mfa-enroll-code");
    await act(async () => {
      codeInput.props.onChangeText("999999");
    });

    const confirmBtn = getButton(renderer, "mfa-enroll-confirm");
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(confirmTotpEnrollmentMock).toHaveBeenCalledTimes(1);
    expect(mockCompleteMfaRevocation).not.toHaveBeenCalled();
  });

  test("client-side validation rejects non-6-digit confirmation code", async () => {
    beginTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-val-1",
      manualSetupKey: "KEYVAL123",
      otpauthUri: "otpauth://totp/NOVA:user?secret=KEYVAL123",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    const codeInput = getTextInput(renderer, "mfa-enroll-code");
    await act(async () => {
      codeInput.props.onChangeText("123");
    });

    const confirmBtn = getButton(renderer, "mfa-enroll-confirm");
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(confirmTotpEnrollmentMock).not.toHaveBeenCalled();
    expect(mockCompleteMfaRevocation).not.toHaveBeenCalled();
  });

  test("enrollment with active factor triggers MFA_FACTOR_CHANGE step-up challenge", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator 1",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "challenge-enroll-stepup-1",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      method: "TOTP",
      methods: ["TOTP"],
      purpose: "MFA_FACTOR_CHANGE",
    });
    beginTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-new-2",
      manualSetupKey: "SETUPKEY456",
      otpauthUri: "otpauth://totp/NOVA:user?secret=SETUPKEY456",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    const renderer = await renderScreen();

    // Enter password
    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    // Press "Tạo khóa TOTP"
    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    // Step-up challenge must be created with MFA_FACTOR_CHANGE
    expect(createMfaChallengeMock).toHaveBeenCalledTimes(1);
    expect(createMfaChallengeMock).toHaveBeenCalledWith(
      { purpose: "MFA_FACTOR_CHANGE" },
      expect.objectContaining({ accessToken: "access-token-active" }),
    );
    // beginTotpEnrollment must not be called yet
    expect(beginTotpEnrollmentMock).not.toHaveBeenCalled();

    // Enter challenge code from existing TOTP
    const challengeInput = getTextInput(renderer, "mfa-lifecycle-code");
    await act(async () => {
      challengeInput.props.onChangeText("112233");
    });

    // Confirm button has label "Xác nhận tạo khóa mới"
    const confirmStepUpBtn = getButton(renderer, "mfa-lifecycle-confirm");
    await act(async () => {
      await confirmStepUpBtn.props.onPress();
    });

    // beginTotpEnrollment must be called with password, challengeId, and code
    expect(beginTotpEnrollmentMock).toHaveBeenCalledTimes(1);
    expect(beginTotpEnrollmentMock).toHaveBeenCalledWith(
      {
        password: "SecretPass123!",
        challengeId: "challenge-enroll-stepup-1",
        code: "112233",
      },
      expect.objectContaining({ accessToken: "access-token-active" }),
    );

    // Challenge card is cleared, enrollment card is now displayed
    expect(hasTextInput(renderer, "mfa-lifecycle-code")).toBe(false);
    expect(hasTextInput(renderer, "mfa-enroll-code")).toBe(true);
  });

  test("canceling step-up challenge resets challenge state and restores screen", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator 1",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "challenge-enroll-stepup-2",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      method: "TOTP",
      methods: ["TOTP"],
      purpose: "MFA_FACTOR_CHANGE",
    });

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    expect(hasTextInput(renderer, "mfa-lifecycle-code")).toBe(true);

    // Press cancel
    const cancelBtn = getButton(renderer, "mfa-lifecycle-cancel");
    await act(async () => {
      cancelBtn.props.onPress();
    });

    // Challenge card is dismissed
    expect(hasTextInput(renderer, "mfa-lifecycle-code")).toBe(false);
    expect(beginTotpEnrollmentMock).not.toHaveBeenCalled();
  });

  test("step-up failure leaves form intact for retry without resetting password", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator 1",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "challenge-enroll-stepup-3",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      method: "TOTP",
      methods: ["TOTP"],
      purpose: "MFA_FACTOR_CHANGE",
    });
    beginTotpEnrollmentMock.mockRejectedValueOnce(
      new ApiError({
        status: 409,
        code: "STEP_UP_VERIFICATION_FAILED",
        message: "Xác thực giao dịch không thành công.",
      }),
    );

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    const challengeInput = getTextInput(renderer, "mfa-lifecycle-code");
    await act(async () => {
      challengeInput.props.onChangeText("999999");
    });

    const confirmStepUpBtn = getButton(renderer, "mfa-lifecycle-confirm");
    await act(async () => {
      await confirmStepUpBtn.props.onPress();
    });

    expect(beginTotpEnrollmentMock).toHaveBeenCalledTimes(1);
    // Challenge card remains visible so user can re-enter code
    expect(hasTextInput(renderer, "mfa-lifecycle-code")).toBe(true);
    // No completeMfaRevocation
    expect(mockCompleteMfaRevocation).not.toHaveBeenCalled();
  });

  test("terminal challenge error (expired/consumed/replay) clears challenge card so user can start a new challenge", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator 1",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "challenge-enroll-stepup-4",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      method: "TOTP",
      methods: ["TOTP"],
      purpose: "MFA_FACTOR_CHANGE",
    });
    beginTotpEnrollmentMock.mockRejectedValueOnce(
      new ApiError({
        status: 409,
        code: "MFA_REPLAY_DETECTED",
        message: "Mã xác thực đã được sử dụng.",
      }),
    );

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    const challengeInput = getTextInput(renderer, "mfa-lifecycle-code");
    await act(async () => {
      challengeInput.props.onChangeText("123456");
    });

    const confirmStepUpBtn = getButton(renderer, "mfa-lifecycle-confirm");
    await act(async () => {
      await confirmStepUpBtn.props.onPress();
    });

    expect(beginTotpEnrollmentMock).toHaveBeenCalledTimes(1);
    // Terminal challenge is cleared; card dismissed to prevent reuse
    expect(hasTextInput(renderer, "mfa-lifecycle-code")).toBe(false);
    expect(mockCompleteMfaRevocation).not.toHaveBeenCalled();
  });

  test("buttons in challenge card are disabled while request is pending", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "cred-active-1",
          customerId: "customer-1",
          status: "ACTIVE",
          displayName: "Authenticator 1",
          credentialType: "TOTP",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          lastAcceptedTimeStep: null,
          enrolledAt: new Date().toISOString(),
          compromisedAt: null,
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "challenge-enroll-stepup-5",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      method: "TOTP",
      methods: ["TOTP"],
      purpose: "MFA_FACTOR_CHANGE",
    });

    let resolveEnrollment!: (val: TotpEnrollmentResponse) => void;
    beginTotpEnrollmentMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveEnrollment = resolve;
      }),
    );

    const renderer = await renderScreen();

    const passwordInput = getTextInput(renderer, "mfa-current-password");
    await act(async () => {
      passwordInput.props.onChangeText("SecretPass123!");
    });

    const beginBtn = getButton(renderer, "mfa-enroll-start");
    await act(async () => {
      await beginBtn.props.onPress();
    });

    const challengeInput = getTextInput(renderer, "mfa-lifecycle-code");
    await act(async () => {
      challengeInput.props.onChangeText("123456");
    });

    const confirmStepUpBtn = getButton(renderer, "mfa-lifecycle-confirm");
    const cancelBtn = getButton(renderer, "mfa-lifecycle-cancel");

    // Initiate submit without awaiting completion immediately
    let submitPromise!: Promise<void>;
    await act(async () => {
      submitPromise = confirmStepUpBtn.props.onPress();
    });

    // While pending, buttons must be disabled to prevent concurrent actions
    expect(confirmStepUpBtn.props.disabled).toBe(true);
    expect(cancelBtn.props.disabled).toBe(true);

    // Resolve enrollment to clean up
    await act(async () => {
      resolveEnrollment({
        credentialId: "cred-new-5",
        manualSetupKey: "SETUPKEY555",
        otpauthUri: "otpauth://totp/NOVA:user?secret=SETUPKEY555",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      await submitPromise;
    });

    expect(hasTextInput(renderer, "mfa-enroll-code")).toBe(true);
  });

  test("preserves in-progress TOTP enrollment across unmount/remount in the same session epoch and clears on cancel or epoch change", async () => {
    beginTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-restore-1",
      manualSetupKey: "RESTOREKEY999",
      otpauthUri: "otpauth://totp/NOVA:user?secret=RESTOREKEY999",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    const firstMount = await renderScreen();
    await act(async () => {
      getTextInput(firstMount, "mfa-current-password").props.onChangeText("SecretPass123!");
    });
    await act(async () => {
      await getButton(firstMount, "mfa-enroll-start").props.onPress();
    });
    expect(hasTextInput(firstMount, "mfa-enroll-code")).toBe(true);

    // Simulates >30s background lock/refresh unmounting the route stack, then returning in the same sessionEpoch
    act(() => {
      firstMount.unmount();
    });
    currentRenderer = null;

    const remounted = await renderScreen();
    expect(hasTextInput(remounted, "mfa-enroll-code")).toBe(true);
    expect(remounted.root.findAllByProps({ children: "RESTOREKEY999" }).length).toBeGreaterThan(0);

    // Cancelling enrollment clears the volatile draft
    await act(async () => {
      getButton(remounted, "mfa-enroll-cancel").props.onPress();
    });
    expect(hasTextInput(remounted, "mfa-enroll-code")).toBe(false);

    // Begin again, then switch sessionEpoch -> another login session must not see prior enrollment
    beginTotpEnrollmentMock.mockResolvedValueOnce({
      credentialId: "cred-restore-2",
      manualSetupKey: "EPOCHTWOKEY",
      otpauthUri: "otpauth://totp/NOVA:user?secret=EPOCHTWOKEY",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    await act(async () => {
      getTextInput(remounted, "mfa-current-password").props.onChangeText("SecretPass123!");
    });
    await act(async () => {
      await getButton(remounted, "mfa-enroll-start").props.onPress();
    });
    expect(hasTextInput(remounted, "mfa-enroll-code")).toBe(true);

    act(() => {
      remounted.unmount();
    });
    currentRenderer = null;

    useAuthMock.mockReturnValue({
      deviceId: "device-test-uuid",
      session: { ...mockSession, sessionEpoch: "epoch-2" },
      status: "authenticated",
      isAuthenticated: true,
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: mockCompleteMfaRevocation,
      clearPendingRecoveryCodes: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });

    const newEpochMount = await renderScreen();
    expect(hasTextInput(newEpochMount, "mfa-enroll-code")).toBe(false);
  });
});
