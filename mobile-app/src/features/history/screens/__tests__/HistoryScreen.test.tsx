import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Share } from "react-native";

import { HistoryScreen } from "@/features/history/screens/HistoryScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  exportAccountStatement,
  getAccountSummary,
  listAccounts,
  listTransactions,
} from "@/features/accounts/services/accountsApi";

const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  return {
    useRouter: () => ({ back: mockBack, push: mockPush }),
    useFocusEffect: (callback: () => void) => {
      React.useEffect(() => {
        callback();
      }, [callback]);
    },
  };
});

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/accounts/services/accountsApi", () => ({
  listAccounts: jest.fn(),
  listTransactions: jest.fn(),
  getAccountSummary: jest.fn(),
  exportAccountStatement: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const listAccountsMock = jest.mocked(listAccounts);
const listTransactionsMock = jest.mocked(listTransactions);
const getAccountSummaryMock = jest.mocked(getAccountSummary);
const exportAccountStatementMock = jest.mocked(exportAccountStatement);

let renderer: ReactTestRenderer | null = null;

describe("HistoryScreen monthly summary and multi-account support", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
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
    jest.useRealTimers();
  });

  it("renders monthly income, expense, net summary and supports switching accounts", async () => {
    listAccountsMock.mockResolvedValue({
      accounts: [
        {
          id: "acc-1",
          displayName: "Tài khoản chính",
          maskedNumber: "••••1111",
          bankName: "NOVA",
          currency: "VND",
          heldAmount: { currency: "VND", amountMinor: "0" },
          availableBalance: { currency: "VND", amountMinor: "3000000" },
          currentBalance: { currency: "VND", amountMinor: "3000000" },
          status: "ACTIVE",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
        {
          id: "acc-2",
          displayName: "Tài khoản phụ",
          maskedNumber: "••••2222",
          bankName: "NOVA",
          currency: "VND",
          heldAmount: { currency: "VND", amountMinor: "0" },
          availableBalance: { currency: "VND", amountMinor: "1000000" },
          currentBalance: { currency: "VND", amountMinor: "1000000" },
          status: "ACTIVE",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    listTransactionsMock
      .mockResolvedValueOnce({
        items: [
          {
            id: "tx-1",
            accountId: "acc-1",
            direction: "CREDIT",
            amount: { currency: "VND", amountMinor: "1500000" },
            fee: { currency: "VND", amountMinor: "0" },
            status: "SUCCEEDED",
            description: "Nhận lương",
            counterpartyName: "Cong ty ABC",
            occurredAt: "2026-11-05T08:00:00.000Z",
          },
          {
            id: "tx-2",
            accountId: "acc-1",
            direction: "DEBIT",
            amount: { currency: "VND", amountMinor: "500000" },
            fee: { currency: "VND", amountMinor: "0" },
            status: "SUCCEEDED",
            description: "Chuyển khoản",
            counterpartyName: "Tran B",
            occurredAt: "2026-11-10T09:00:00.000Z",
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "tx-3",
            accountId: "acc-2",
            direction: "DEBIT",
            amount: { currency: "VND", amountMinor: "200000" },
            fee: { currency: "VND", amountMinor: "0" },
            status: "SUCCEEDED",
            description: "Thanh toán",
            counterpartyName: "Shop",
            occurredAt: "2026-11-12T09:00:00.000Z",
          },
        ],
        nextCursor: "cursor-next",
      });

    act(() => {
      renderer = create(<HistoryScreen />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer!.root.findByProps({ testID: "history-account-switcher" })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: "history-summary-income" }).props.children).toEqual(["+", "1.500.000 ₫"]);
    expect(renderer!.root.findByProps({ testID: "history-summary-expense" }).props.children).toEqual(["−", "500.000 ₫"]);
    expect(renderer!.root.findByProps({ testID: "history-summary-net" }).props.children).toBe("+1.000.000 ₫");

    const acc2Chip = renderer!.root.findByProps({ testID: "history-account-acc-2" });
    await act(async () => {
      acc2Chip.props.onPress();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listTransactionsMock).toHaveBeenLastCalledWith(
      "acc-2",
      expect.objectContaining({ limit: 20 }),
    );
    expect(renderer!.root.findByProps({ testID: "history-summary-net" }).props.children).toBe("−200.000 ₫");
    expect(renderer!.root.findByProps({ testID: "history-load-more" })).toBeTruthy();
  });

  it("supports server-side keyword/period filtering, server summary, and statement export", async () => {
    const shareSpy = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    listAccountsMock.mockResolvedValue({
      accounts: [
        {
          id: "acc-1",
          displayName: "Tài khoản chính",
          maskedNumber: "••••1111",
          bankName: "NOVA",
          currency: "VND",
          heldAmount: { currency: "VND", amountMinor: "0" },
          availableBalance: { currency: "VND", amountMinor: "3000000" },
          currentBalance: { currency: "VND", amountMinor: "3000000" },
          status: "ACTIVE",
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    listTransactionsMock.mockResolvedValue({
      items: [
        {
          id: "tx-1",
          accountId: "acc-1",
          direction: "CREDIT",
          amount: { currency: "VND", amountMinor: "1500000" },
          fee: { currency: "VND", amountMinor: "0" },
          status: "SUCCEEDED",
          description: "Nhận lương",
          counterpartyName: "Cong ty ABC",
          occurredAt: "2026-11-05T08:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    getAccountSummaryMock.mockResolvedValue({
      accountId: "acc-1",
      month: "2026-11",
      monthLabel: "11/2026",
      currency: "VND",
      totalIncomeMinor: "9000000",
      totalExpenseMinor: "1000000",
      netMinor: "8000000",
      succeededCount: 12,
      creditCount: 7,
      debitCount: 5,
    });
    exportAccountStatementMock.mockResolvedValue("\uFEFFMã tham chiếu,Nội dung\r\nREF-1,Nhận lương");

    act(() => {
      renderer = create(<HistoryScreen />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer!.root.findByProps({ testID: "history-summary-income" }).props.children).toEqual(["+", "9.000.000 ₫"]);
    expect(renderer!.root.findByProps({ testID: "history-summary-net" }).props.children).toBe("+8.000.000 ₫");

    const searchInput = renderer!.root.findByProps({ testID: "history-search-input" });
    await act(async () => {
      searchInput.props.onChangeText("REF-LUONG");
    });
    const searchBtn = renderer!.root.findByProps({ testID: "history-search-submit" });
    await act(async () => {
      searchBtn.props.onPress();
    });

    expect(listTransactionsMock).toHaveBeenLastCalledWith(
      "acc-1",
      expect.objectContaining({ q: "REF-LUONG" }),
    );

    const thisMonthChip = renderer!.root.findByProps({ testID: "history-period-this_month" });
    await act(async () => {
      thisMonthChip.props.onPress();
    });
    expect(listTransactionsMock).toHaveBeenLastCalledWith(
      "acc-1",
      expect.objectContaining({ from: "2026-11-01", to: "2026-11-30" }),
    );

    const exportBtn = renderer!.root.findByProps({ testID: "history-export-statement" });
    await act(async () => {
      await exportBtn.props.onPress();
    });

    expect(exportAccountStatementMock).toHaveBeenCalledWith(
      "acc-1",
      expect.objectContaining({ format: "csv", from: "2026-11-01", to: "2026-11-30" }),
    );
    expect(shareSpy).toHaveBeenCalled();
    expect(renderer!.root.findByProps({ testID: "history-export-notice" })).toBeTruthy();
    shareSpy.mockRestore();
  });
});
