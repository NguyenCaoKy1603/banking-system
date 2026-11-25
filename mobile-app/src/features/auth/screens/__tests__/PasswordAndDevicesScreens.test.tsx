import type { ReactNode } from "react";
import { Alert } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useAuth } from "@/features/auth/context/AuthContext";
import { ChangePasswordScreen } from "@/features/auth/screens/ChangePasswordScreen";
import { ForgotPasswordScreen } from "@/features/auth/screens/ForgotPasswordScreen";
import {
  changePassword,
  createMfaChallenge,
  forgotPassword,
  listDevices,
  listMfaMethods,
  resetPassword,
  revokeDevice,
} from "@/features/auth/services/authApi";
import { DevicesScreen } from "@/features/profile/screens/DevicesScreen";

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/auth/services/authApi", () => ({
  changePassword: jest.fn(),
  createMfaChallenge: jest.fn(),
  forgotPassword: jest.fn(),
  listDevices: jest.fn(),
  listMfaMethods: jest.fn(),
  resetPassword: jest.fn(),
  revokeDevice: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const changePasswordMock = jest.mocked(changePassword);
const createMfaChallengeMock = jest.mocked(createMfaChallenge);
const forgotPasswordMock = jest.mocked(forgotPassword);
const listDevicesMock = jest.mocked(listDevices);
const listMfaMethodsMock = jest.mocked(listMfaMethods);
const resetPasswordMock = jest.mocked(resetPassword);
const revokeDeviceMock = jest.mocked(revokeDevice);

let renderer: ReactTestRenderer | null = null;

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("ForgotPasswordScreen, ChangePasswordScreen, and DevicesScreen", () => {
  const mockCompleteMfaRevocation = jest.fn().mockResolvedValue(undefined);
  const mockLogout = jest.fn().mockResolvedValue({
    localSessionCleared: true,
    remoteRevoked: true,
    recoveryIntentsPreserved: true,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      isAuthenticated: true,
      deviceId: "device-current-1",
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: mockCompleteMfaRevocation,
      clearPendingRecoveryCodes: jest.fn(),
      logout: mockLogout,
      logoutAll: jest.fn(),
      session: {
        accessToken: "token-1",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 60_000,
        sessionEpoch: "epoch-1",
        user: {
          id: "user-1",
          fullName: "Security Tester",
          email: "tester@example.com",
          phoneNumber: "0900000001",
          createdAt: "2026-09-01T00:00:00Z",
        },
      },
    });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
    jest.restoreAllMocks();
  });

  it("ForgotPasswordScreen sends email OTP then resets password", async () => {
    forgotPasswordMock.mockResolvedValueOnce({
      challengeId: "forgot-chal-1",
      expiresAt: "2026-11-25T10:00:00Z",
      methods: ["EMAIL_OTP"],
      method: "EMAIL_OTP",
      purpose: "PASSWORD_RESET",
      maskedDestination: "te****@example.com",
    });
    resetPasswordMock.mockResolvedValueOnce({
      status: "PASSWORD_RESET",
      sessionsRevoked: true,
    });

    act(() => {
      renderer = create(<ForgotPasswordScreen />);
    });
    await flushMicrotasks();

    act(() => {
      renderer!.root.findByProps({ testID: "forgot-email" }).props.onChangeText("tester@example.com");
    });
    await act(async () => {
      await renderer!.root.findByProps({ testID: "forgot-submit" }).props.onPress();
    });
    await flushMicrotasks();

    expect(forgotPasswordMock).toHaveBeenCalledWith(
      { email: "tester@example.com" },
      { deviceId: "device-current-1" },
    );

    act(() => {
      renderer!.root.findByProps({ testID: "reset-otp" }).props.onChangeText("654321");
      renderer!.root.findByProps({ testID: "reset-new-password" }).props.onChangeText("NewStrong!2026");
      renderer!.root.findByProps({ testID: "reset-confirm-password" }).props.onChangeText("NewStrong!2026");
    });
    await act(async () => {
      await renderer!.root.findByProps({ testID: "reset-submit" }).props.onPress();
    });
    await flushMicrotasks();

    expect(resetPasswordMock).toHaveBeenCalledWith(
      {
        challengeId: "forgot-chal-1",
        proof: "654321",
        newPassword: "NewStrong!2026",
      },
      { deviceId: "device-current-1" },
    );
    expect(renderer!.root.findByProps({ testID: "forgot-back-to-login" })).toBeTruthy();
  });

  it("ChangePasswordScreen enforces TOTP challenge when active TOTP is enrolled", async () => {
    listMfaMethodsMock.mockResolvedValueOnce({
      items: [
        {
          id: "totp-1",
          customerId: "user-1",
          credentialType: "TOTP",
          displayName: "Authenticator",
          status: "ACTIVE",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          lastAcceptedTimeStep: null,
          enrolledAt: "2026-09-01T00:00:00Z",
          lastUsedAt: null,
          revokedAt: null,
          compromisedAt: null,
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
    });
    createMfaChallengeMock.mockResolvedValueOnce({
      challengeId: "pw-change-chal-1",
      expiresAt: "2026-11-25T10:00:00Z",
      methods: ["TOTP"],
      method: "TOTP",
      purpose: "PASSWORD_CHANGE",
    });
    changePasswordMock.mockResolvedValueOnce({
      status: "PASSWORD_CHANGED",
      sessionsRevoked: true,
    });

    act(() => {
      renderer = create(<ChangePasswordScreen />);
    });
    await flushMicrotasks();

    act(() => {
      renderer!.root.findByProps({ testID: "change-current-password" }).props.onChangeText("OldStrong!1234");
      renderer!.root.findByProps({ testID: "change-new-password" }).props.onChangeText("NewStrong!5678");
      renderer!.root.findByProps({ testID: "change-confirm-password" }).props.onChangeText("NewStrong!5678");
    });

    // First click fetches TOTP challenge
    await act(async () => {
      await renderer!.root.findByProps({ testID: "change-password-submit" }).props.onPress();
    });
    await flushMicrotasks();

    expect(createMfaChallengeMock).toHaveBeenCalledWith(
      { purpose: "PASSWORD_CHANGE", method: "TOTP" },
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-current-1" }),
    );

    act(() => {
      renderer!.root.findByProps({ testID: "change-totp-code" }).props.onChangeText("123456");
    });

    await act(async () => {
      await renderer!.root.findByProps({ testID: "change-password-submit" }).props.onPress();
    });
    await flushMicrotasks();

    expect(changePasswordMock).toHaveBeenCalledWith(
      {
        currentPassword: "OldStrong!1234",
        newPassword: "NewStrong!5678",
        stepUp: { method: "TOTP", challengeId: "pw-change-chal-1", proof: "123456" },
      },
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-current-1" }),
    );
    expect(mockCompleteMfaRevocation).toHaveBeenCalledTimes(1);
  });

  it("DevicesScreen lists devices and revokes another device on confirmation", async () => {
    listDevicesMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "dev-rec-1",
            deviceId: "device-current-1",
            deviceName: "iPhone 15 Pro",
            attestationStatus: "PENDING",
            isCurrentDevice: true,
            lastSeenAt: "2026-11-25T09:00:00Z",
            createdAt: "2026-11-25T08:00:00Z",
            activeSessionCount: 1,
          },
          {
            id: "dev-rec-2",
            deviceId: "device-other-2",
            deviceName: "Pixel 9",
            attestationStatus: "PENDING",
            isCurrentDevice: false,
            lastSeenAt: "2026-11-25T07:00:00Z",
            createdAt: "2026-11-25T06:00:00Z",
            activeSessionCount: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "dev-rec-1",
            deviceId: "device-current-1",
            deviceName: "iPhone 15 Pro",
            attestationStatus: "PENDING",
            isCurrentDevice: true,
            lastSeenAt: "2026-11-25T09:00:00Z",
            createdAt: "2026-11-25T08:00:00Z",
            activeSessionCount: 1,
          },
        ],
      });
    revokeDeviceMock.mockResolvedValueOnce(undefined);

    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((b) => b.style === "destructive");
      destructive?.onPress?.();
    });

    act(() => {
      renderer = create(<DevicesScreen />);
    });
    await flushMicrotasks();

    expect(JSON.stringify(renderer!.toJSON())).toContain("Thiết bị hiện tại");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Pixel 9");

    await act(async () => {
      renderer!.root.findByProps({ testID: "revoke-device-dev-rec-2" }).props.onPress();
    });
    await flushMicrotasks();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(revokeDeviceMock).toHaveBeenCalledWith(
      "dev-rec-2",
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-current-1" }),
    );
    expect(mockLogout).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({ testID: "device-card-dev-rec-2" })).toHaveLength(0);
  });
});
