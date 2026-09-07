import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { MfaMethodsScreen } from "@/features/auth/screens/MfaMethodsScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as authApi from "@/features/auth/services/authApi";
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
});
