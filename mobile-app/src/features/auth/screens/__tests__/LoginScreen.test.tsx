import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { LoginScreen } from "@/features/auth/screens/LoginScreen";
import { useAuth } from "@/features/auth/context/AuthContext";

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);

// ─── Fixtures ────────────────────────────────────────────────────────────────

const syntheticRecoveryCodes = [
  "code-login-000000000001",
  "code-login-000000000002",
  "code-login-000000000003",
  "code-login-000000000004",
  "code-login-000000000005",
  "code-login-000000000006",
  "code-login-000000000007",
  "code-login-000000000008",
  "code-login-000000000009",
  "code-login-000000000010",
];

const mockLogin = jest.fn();
const mockClearPendingRecoveryCodes = jest.fn();

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

function findByTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAllByProps({ testID });
}

describe("LoginScreen — Post-revocation recovery codes display", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      deviceId: "device-test-uuid",
      session: null,
      status: "anonymous",
      isAuthenticated: false,
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: mockLogin,
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: mockClearPendingRecoveryCodes,
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });
  });

  test("renders memory-only recovery card and hides form and links when pendingRecoveryCodes exists", async () => {
    useAuthMock.mockReturnValue({
      deviceId: "device-test-uuid",
      session: null,
      status: "anonymous",
      isAuthenticated: false,
      logoutNotice: null,
      pendingRecoveryCodes: syntheticRecoveryCodes,
      refreshAccessToken: jest.fn(),
      login: mockLogin,
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: mockClearPendingRecoveryCodes,
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    // Recovery card acknowledge button must be present
    const ackButton = byTestId(renderer, "mfa-recovery-codes-acknowledge");
    expect(ackButton).toBeDefined();

    // Form fields and navigation links must be hidden
    expect(findByTestId(renderer, "login-email")).toHaveLength(0);
    expect(findByTestId(renderer, "login-password")).toHaveLength(0);
    expect(findByTestId(renderer, "login-submit")).toHaveLength(0);
    expect(findByTestId(renderer, "login-register")).toHaveLength(0);

    // Clicking acknowledge calls clearPendingRecoveryCodes
    await act(async () => {
      await ackButton.props.onPress();
    });

    expect(mockClearPendingRecoveryCodes).toHaveBeenCalledTimes(1);
  });

  test("renders standard login form when pendingRecoveryCodes is null", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    // Recovery card acknowledge button must NOT be present
    expect(findByTestId(renderer, "mfa-recovery-codes-acknowledge")).toHaveLength(0);

    // Form fields and register link must be visible
    expect(findByTestId(renderer, "login-email").length).toBeGreaterThan(0);
    expect(findByTestId(renderer, "login-password").length).toBeGreaterThan(0);
    expect(findByTestId(renderer, "login-submit").length).toBeGreaterThan(0);
    expect(findByTestId(renderer, "login-register").length).toBeGreaterThan(0);
  });

  test("displays logoutNotice when factor is removed", async () => {
    const noticeText = "Phương thức Authenticator đã được thu hồi. Vui lòng đăng nhập lại.";
    useAuthMock.mockReturnValue({
      deviceId: "device-test-uuid",
      session: null,
      status: "anonymous",
      isAuthenticated: false,
      logoutNotice: noticeText,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: mockLogin,
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: mockClearPendingRecoveryCodes,
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    // Form is visible
    expect(findByTestId(renderer, "login-email").length).toBeGreaterThan(0);

    // Notice text is present
    const texts = renderer.root.findAllByType("Text" as any);
    const noticeNode = texts.find((t) => t.props.children === noticeText);
    expect(noticeNode).toBeDefined();
  });
});
