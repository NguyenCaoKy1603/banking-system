import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { TransferScreen } from "@/features/transfers/screens/TransferScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { listAccounts } from "@/features/accounts/services/accountsApi";
import { getControlPolicy } from "@/features/control/services/controlPolicyApi";
import {
  lookupBeneficiary,
  lookupInternalRecipient,
} from "@/features/transfers/services/transfersApi";
import { loadTransferIntent } from "@/features/transfers/storage/transferIntentStorage";
import { listMfaMethods } from "@/features/auth/services/authApi";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { ApiError } from "@/services/api/ApiError";

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockRouteParams: { accountNumber?: string; beneficiaryId?: string } = {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockRouteParams,
  useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/accounts/services/accountsApi", () => ({
  listAccounts: jest.fn(),
}));

jest.mock("@/features/control/services/controlPolicyApi", () => ({
  getControlPolicy: jest.fn(),
}));

jest.mock("@/features/transfers/services/transfersApi", () => ({
  lookupBeneficiary: jest.fn(),
  lookupInternalRecipient: jest.fn(),
  quoteTransfer: jest.fn(),
  submitTransfer: jest.fn(),
  getTransfer: jest.fn(),
}));

jest.mock("@/features/transfers/storage/transferIntentStorage", () => ({
  loadTransferIntent: jest.fn(),
  saveTransferIntent: jest.fn(),
  clearTransferIntent: jest.fn(),
}));

jest.mock("@/features/auth/services/authApi", () => ({
  listMfaMethods: jest.fn(),
}));

jest.mock("@/features/auth/services/otpApi", () => ({
  createOtpChallenge: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const listAccountsMock = jest.mocked(listAccounts);
const getControlPolicyMock = jest.mocked(getControlPolicy);
const lookupInternalRecipientMock = jest.mocked(lookupInternalRecipient);
const lookupBeneficiaryMock = jest.mocked(lookupBeneficiary);
const loadTransferIntentMock = jest.mocked(loadTransferIntent);
const listMfaMethodsMock = jest.mocked(listMfaMethods);
const createOtpChallengeMock = jest.mocked(createOtpChallenge);

let renderer: ReactTestRenderer | null = null;

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("TransferScreen QR route integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
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
          fullName: "Sender Demo",
          email: "sender@example.test",
          phoneNumber: "0900000001",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      },
    });
    listAccountsMock.mockResolvedValue({
      accounts: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          displayName: "Tài khoản thanh toán",
          maskedNumber: "••••1234",
          bankName: "NOVA",
          currency: "VND",
          heldAmount: { currency: "VND", amountMinor: "0" },
          availableBalance: { currency: "VND", amountMinor: "5000000" },
          currentBalance: { currency: "VND", amountMinor: "5000000" },
          status: "ACTIVE",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    getControlPolicyMock.mockResolvedValue({
      configVersion: "v1",
      globalKillSwitch: false,
      transfersEnabled: true,
      allowlisted: true,
      maxTransferAmountMinor: "50000000",
      stepUpMethods: ["TOTP"],
      savingsEnabled: true,
      savingsAllowlisted: true,
      maxSavingsAmountMinor: "100000000",
      savingsStepUpMethods: ["TOTP"],
      creditEnabled: true,
      creditAllowlisted: true,
      creditPaymentsEnabled: true,
      cardControlsEnabled: true,
      maxCreditPaymentAmountMinor: "50000000",
      creditPaymentStepUpMethods: ["TOTP"],
      cardUnlockStepUpMethods: ["TOTP"],
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    loadTransferIntentMock.mockResolvedValue(null);
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

  it("auto-verifies QR accountNumber on the server and advances to amount step", async () => {
    mockRouteParams = { accountNumber: "970400009999" };
    lookupInternalRecipientMock.mockResolvedValue({
      recipient: {
        lookupId: "33333333-3333-4333-8333-333333333333",
        accountHolderName: "NGUYEN VAN NHAN",
        maskedAccountNumber: "••••9999",
        bankName: "NOVA",
        status: "ACTIVE",
        expiresAt: "2026-09-01T01:00:00.000Z",
      },
    });

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    expect(lookupInternalRecipientMock).toHaveBeenCalledWith(
      "970400009999",
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-1" }),
    );
    expect(lookupBeneficiaryMock).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ testID: "transfer-amount" })).toBeTruthy();
    expect(JSON.stringify(renderer!.toJSON())).toContain("NGUYEN VAN NHAN");
  });

  it("keeps beneficiary step with prefilled accountNumber and server error when QR lookup fails", async () => {
    mockRouteParams = { accountNumber: "970400000000" };
    lookupInternalRecipientMock.mockRejectedValue(
      new ApiError({
        status: 404,
        code: "RECIPIENT_NOT_FOUND",
        message: "Không tìm thấy tài khoản nhận trong hệ thống.",
      }),
    );

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    const field = renderer!.root.findByProps({ testID: "transfer-beneficiary-id" });
    expect(field.props.value).toBe("970400000000");
    expect(field.props.error).toBe("Không tìm thấy tài khoản nhận trong hệ thống.");
  });

  it("does not overwrite a pending crash-recovery intent when opened with QR params", async () => {
    mockRouteParams = { accountNumber: "970400009999" };
    loadTransferIntentMock.mockResolvedValue({
      phase: "DRAFT_QUOTE",
      submitAttempted: false,
      userId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "transfer-idem-key-123456",
      createdAt: Date.now(),
      quote: {
        quoteId: "44444444-4444-4444-8444-444444444444",
        sourceAccountId: "22222222-2222-4222-8222-222222222222",
        beneficiary: {
          id: "55555555-5555-4555-8555-555555555555",
          displayName: "Pending Recovery Target",
          maskedAccountNumber: "••••5555",
          bankName: "NOVA",
          status: "ACTIVE",
        },
        amount: { currency: "VND", amountMinor: "100000" },
        fee: { currency: "VND", amountMinor: "0" },
        totalDebit: { currency: "VND", amountMinor: "100000" },
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    });
    createOtpChallengeMock.mockResolvedValue({
      challengeId: "66666666-6666-4666-8666-666666666666",
      purpose: "TRANSFER",
      methods: ["TOTP"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    expect(lookupInternalRecipientMock).not.toHaveBeenCalled();
    expect(createOtpChallengeMock).toHaveBeenCalledWith(
      { purpose: "TRANSFER", resourceId: "44444444-4444-4444-8444-444444444444" },
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-1" }),
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain("Xác thực");
  });
});
