import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Share } from "react-native";

import { TransactionDetailScreen } from "@/features/history/screens/TransactionDetailScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { getTransactionDetail } from "@/features/accounts/services/accountsApi";

const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ accountId: "acc-1", transactionId: "tx-1" }),
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/accounts/services/accountsApi", () => ({
  getTransactionDetail: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const getTransactionDetailMock = jest.mocked(getTransactionDetail);

let renderer: ReactTestRenderer | null = null;

describe("TransactionDetailScreen receipt sharing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      isAuthenticated: true,
      deviceId: "device-1",
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
      session: {
        accessToken: "token-1",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 60_000,
        sessionEpoch: "epoch-1",
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          fullName: "Nguyen Van A",
          email: "user@example.test",
          phoneNumber: "0900000001",
          createdAt: "2026-09-01T00:00:00.000Z",
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
  });

  it("renders receipt share button and shares formatted transaction receipt", async () => {
    const shareSpy = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    getTransactionDetailMock.mockResolvedValue({
      id: "tx-1",
      accountId: "acc-1",
      direction: "DEBIT",
      amount: { currency: "VND", amountMinor: "1250000" },
      fee: { currency: "VND", amountMinor: "0" },
      status: "SUCCEEDED",
      kind: "TRANSFER",
      description: "Thanh toán tiền nhà",
      counterpartyName: "Nguyen Thi B",
      occurredAt: "2026-11-15T10:30:00.000Z",
      reference: "TX-REF-20261115",
      createdAt: "2026-11-15T10:30:00.000Z",
      completedAt: "2026-11-15T10:30:02.000Z",
    });

    act(() => {
      renderer = create(<TransactionDetailScreen />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const shareButton = renderer!.root.findByProps({ testID: "transaction-share-receipt" });
    await act(async () => {
      await shareButton.props.onPress();
    });

    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Biên lai giao dịch TX-REF-20261115",
        message: expect.stringContaining("TX-REF-20261115"),
      }),
    );
    expect(renderer!.root.findByProps({ testID: "transaction-receipt-notice" })).toBeTruthy();
    shareSpy.mockRestore();
  });
});
