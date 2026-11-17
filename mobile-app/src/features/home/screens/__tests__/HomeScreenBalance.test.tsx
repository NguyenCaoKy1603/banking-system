import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { HomeScreen } from "@/features/home/screens/HomeScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as accountsApi from "@/features/accounts/services/accountsApi";
import * as authApi from "@/features/auth/services/authApi";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  return {
    Link: ({ children }: { children: ReactNode }) => children,
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useFocusEffect: (cb: () => void) => {
      React.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/accounts/services/accountsApi");
jest.mock("@/features/auth/services/authApi");

const useAuthMock = jest.mocked(useAuth);
const listAccountsMock = jest.mocked(accountsApi.listAccounts);
const listMfaMethodsMock = jest.mocked(authApi.listMfaMethods);

let renderer: ReactTestRenderer | null = null;

describe("HomeScreen — Aggregate balance & multi-account switcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      deviceId: "device-home-1",
      session: {
        accessToken: "access-token-home",
        refreshToken: "refresh-token-home",
        accessTokenExpiresAt: Date.now() + 900_000,
        sessionEpoch: "epoch-1",
        user: {
          id: "user-home-1",
          fullName: "Trần Văn B",
          email: "vanb@example.com",
          phoneNumber: "0909999999",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
      status: "authenticated",
      isAuthenticated: true,
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });
    listMfaMethodsMock.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  it("sums total balance across multiple payment accounts and allows switching selected account", async () => {
    listAccountsMock.mockResolvedValue({
      accounts: [
        {
          id: "acc-1",
          displayName: "Thanh toán chính",
          maskedNumber: "••••1111",
          bankName: "NOVA",
          currency: "VND",
          heldAmount: { currency: "VND", amountMinor: "0" },
          availableBalance: { currency: "VND", amountMinor: "3000000" },
          currentBalance: { currency: "VND", amountMinor: "3000000" },
          status: "ACTIVE",
          updatedAt: "2026-11-01T00:00:00Z",
        },
        {
          id: "acc-2",
          displayName: "Thanh toán phụ",
          maskedNumber: "••••2222",
          bankName: "NOVA",
          currency: "VND",
          heldAmount: { currency: "VND", amountMinor: "0" },
          availableBalance: { currency: "VND", amountMinor: "2500000" },
          currentBalance: { currency: "VND", amountMinor: "2500000" },
          status: "ACTIVE",
          updatedAt: "2026-11-01T00:00:00Z",
        },
      ],
    });

    act(() => {
      renderer = create(<HomeScreen />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const toggleBalance = renderer!.root.findByProps({ testID: "home-toggle-balance" });
    act(() => {
      toggleBalance.props.onPress();
    });

    expect(renderer!.root.findByProps({ testID: "home-total-balance" }).props.children).toBe("5.500.000 ₫");
    expect(renderer!.root.findByProps({ testID: "home-account-switcher" })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: "home-account-number" }).props.children).toBe("••••1111");

    const chip2 = renderer!.root.findByProps({ testID: "home-account-chip-acc-2" });
    act(() => {
      chip2.props.onPress();
    });

    expect(renderer!.root.findByProps({ testID: "home-account-number" }).props.children).toBe("••••2222");
    expect(renderer!.root.findByProps({ testID: "home-total-balance" }).props.children).toBe("5.500.000 ₫");
  });
});
