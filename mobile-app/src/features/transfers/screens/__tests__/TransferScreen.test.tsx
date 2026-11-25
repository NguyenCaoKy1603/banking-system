import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { TransferScreen } from "@/features/transfers/screens/TransferScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { listAccounts } from "@/features/accounts/services/accountsApi";
import { getControlPolicy } from "@/features/control/services/controlPolicyApi";
import {
  lookupBeneficiary,
  lookupExternalRecipient,
  lookupInternalRecipient,
  quoteTransfer,
  submitTransfer,
} from "@/features/transfers/services/transfersApi";
import { loadTransferIntent } from "@/features/transfers/storage/transferIntentStorage";
import { listMfaMethods } from "@/features/auth/services/authApi";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { ApiError } from "@/services/api/ApiError";

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockRouteParams: {
  accountNumber?: string;
  beneficiaryId?: string;
  bankBin?: string;
  amountMinor?: string;
  description?: string;
} = {};

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
  lookupExternalRecipient: jest.fn(),
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
const lookupExternalRecipientMock = jest.mocked(lookupExternalRecipient);
const lookupBeneficiaryMock = jest.mocked(lookupBeneficiary);
const quoteTransferMock = jest.mocked(quoteTransfer);
const submitTransferMock = jest.mocked(submitTransfer);
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

  it("shows biometric button when enrolled, amount <= 1,000,000 VND, and risk is LOW", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "mfa-bio-1",
          customerId: "11111111-1111-4111-8111-111111111111",
          credentialType: "BIOMETRIC",
          deviceId: "device-1",
          displayName: "Face ID",
          status: "ACTIVE",
          algorithm: "HMAC-SHA256",
          digits: 6,
          periodSeconds: 30,
          lastAcceptedTimeStep: null,
          enrolledAt: "2026-09-01T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
          compromisedAt: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "mfa-totp-1",
          customerId: "11111111-1111-4111-8111-111111111111",
          credentialType: "TOTP",
          displayName: "Authenticator",
          status: "ACTIVE",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          lastAcceptedTimeStep: null,
          enrolledAt: "2026-09-01T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
          compromisedAt: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    loadTransferIntentMock.mockResolvedValue({
      phase: "DRAFT_QUOTE",
      submitAttempted: false,
      userId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "transfer-idem-key-bio-low",
      createdAt: Date.now(),
      quote: {
        quoteId: "44444444-4444-4444-8444-444444444445",
        sourceAccountId: "22222222-2222-4222-8222-222222222222",
        beneficiary: {
          id: "55555555-5555-4555-8555-555555555555",
          displayName: "Low Risk Target",
          maskedAccountNumber: "••••5555",
          bankName: "NOVA",
          status: "ACTIVE",
        },
        amount: { currency: "VND", amountMinor: "1000000" },
        fee: { currency: "VND", amountMinor: "0" },
        totalDebit: { currency: "VND", amountMinor: "1000000" },
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        anomalyAssessment: {
          riskLevel: "LOW",
          riskScore: 0,
          flagged: false,
          requiresConfirmation: false,
          summary: "Giao dịch nằm trong ngưỡng hoạt động bình thường.",
          flags: [],
          evaluatedAt: new Date().toISOString(),
        },
      },
    });
    createOtpChallengeMock.mockResolvedValue({
      challengeId: "66666666-6666-4666-8666-666666666667",
      purpose: "TRANSFER",
      method: "TOTP",
      methods: ["TOTP", "BIOMETRIC"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    const biometricButton = renderer!.root.findByProps({ testID: "transfer-step-up-biometric" });
    expect(biometricButton.props.label).toBe("Xác thực bằng Vân tay / Face ID");
  });

  it("hides biometric button and enforces TOTP when amount > 1,000,000 VND or risk is HIGH/CRITICAL", async () => {
    listMfaMethodsMock.mockResolvedValue({
      items: [
        {
          id: "mfa-bio-1",
          customerId: "11111111-1111-4111-8111-111111111111",
          credentialType: "BIOMETRIC",
          deviceId: "device-1",
          displayName: "Face ID",
          status: "ACTIVE",
          algorithm: "HMAC-SHA256",
          digits: 6,
          periodSeconds: 30,
          lastAcceptedTimeStep: null,
          enrolledAt: "2026-09-01T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
          compromisedAt: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    loadTransferIntentMock.mockResolvedValue({
      phase: "DRAFT_QUOTE",
      submitAttempted: false,
      userId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "transfer-idem-key-totp-only",
      createdAt: Date.now(),
      quote: {
        quoteId: "44444444-4444-4444-8444-444444444446",
        sourceAccountId: "22222222-2222-4222-8222-222222222222",
        beneficiary: {
          id: "55555555-5555-4555-8555-555555555555",
          displayName: "High Value Target",
          maskedAccountNumber: "••••5555",
          bankName: "NOVA",
          status: "ACTIVE",
        },
        amount: { currency: "VND", amountMinor: "1000001" },
        fee: { currency: "VND", amountMinor: "1000" },
        totalDebit: { currency: "VND", amountMinor: "1001001" },
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        anomalyAssessment: {
          riskLevel: "HIGH",
          riskScore: 65,
          flagged: true,
          requiresConfirmation: true,
          summary: "Cảnh báo giao dịch bất thường mức cao.",
          flags: [],
          evaluatedAt: new Date().toISOString(),
        },
      },
    });
    createOtpChallengeMock.mockResolvedValue({
      challengeId: "66666666-6666-4666-8666-666666666668",
      purpose: "TRANSFER",
      method: "TOTP",
      methods: ["TOTP", "BIOMETRIC"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    expect(renderer!.root.findAllByProps({ testID: "transfer-step-up-biometric" })).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain("bắt buộc xác thực bằng mã TOTP");
  });

  it("supports switching to NAPAS 24/7 interbank mode, selecting a bank, and looking up an external recipient", async () => {
    lookupExternalRecipientMock.mockResolvedValue({
      recipient: {
        lookupId: "ext-lookup-vcb-1",
        rail: "NAPAS_IBFT",
        bankBin: "970436",
        bankCode: "VCB",
        accountHolderName: "NGUYEN VAN MINH (VCB)",
        maskedAccountNumber: "••••0001",
        bankName: "Vietcombank",
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    });

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    const napasTab = renderer!.root.findByProps({ testID: "transfer-rail-napas" });
    act(() => {
      napasTab.props.onPress();
    });

    expect(renderer!.root.findByProps({ testID: "transfer-napas-bank-970436" })).toBeTruthy();
    const accountField = renderer!.root.findByProps({ testID: "transfer-beneficiary-id" });
    act(() => {
      accountField.props.onChangeText("99990001");
    });

    const continueButton = renderer!.root.findByProps({ testID: "transfer-lookup-beneficiary" });
    await act(async () => {
      await continueButton.props.onPress();
    });
    await flushMicrotasks();

    expect(lookupExternalRecipientMock).toHaveBeenCalledWith(
      "970436",
      "99990001",
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-1" }),
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain("NGUYEN VAN MINH (VCB)");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Vietcombank");
  });

  it("handles incoming dynamic VietQR route params (bankBin, amountMinor, description)", async () => {
    mockRouteParams = {
      accountNumber: "99990001",
      bankBin: "970436",
      amountMinor: "250000",
      description: "Tien an trua",
    };
    lookupExternalRecipientMock.mockResolvedValue({
      recipient: {
        lookupId: "ext-lookup-vcb-dynamic",
        rail: "NAPAS_IBFT",
        bankBin: "970436",
        bankCode: "VCB",
        accountHolderName: "NGUYEN VAN MINH (VCB)",
        maskedAccountNumber: "••••0001",
        bankName: "Vietcombank",
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    });

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    expect(lookupExternalRecipientMock).toHaveBeenCalledWith(
      "970436",
      "99990001",
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-1" }),
    );

    // Automatically advances to amount step with prefilled amount
    const amountInput = renderer!.root.findByProps({ testID: "transfer-amount" });
    expect(amountInput.props.value).toBe("250000");

    // Renders prefilled transfer message / description
    expect(JSON.stringify(renderer!.toJSON())).toContain("Tien an trua");
  });

  it("requires explicit high-risk confirmation before CRITICAL transfer review and forwards confirmHighRisk on submit", async () => {
    mockRouteParams = {
      accountNumber: "99990001",
      bankBin: "970436",
      amountMinor: "250000",
      description: "Critical test",
    };
    lookupExternalRecipientMock.mockResolvedValue({
      recipient: {
        lookupId: "ext-lookup-critical",
        rail: "NAPAS_IBFT",
        bankBin: "970436",
        bankCode: "VCB",
        accountHolderName: "NGUYEN VAN MINH (VCB)",
        maskedAccountNumber: "••••0001",
        bankName: "Vietcombank",
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    });
    quoteTransferMock.mockResolvedValue({
      quoteId: "44444444-4444-4444-8444-444444444499",
      sourceAccountId: "22222222-2222-4222-8222-222222222222",
      beneficiary: {
        id: "55555555-5555-4555-8555-555555555555",
        displayName: "NGUYEN VAN MINH (VCB)",
        maskedAccountNumber: "••••0001",
        bankName: "Vietcombank",
        status: "ACTIVE",
      },
      amount: { currency: "VND", amountMinor: "250000" },
      fee: { currency: "VND", amountMinor: "0" },
      totalDebit: { currency: "VND", amountMinor: "250000" },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      anomalyAssessment: {
        riskLevel: "CRITICAL",
        riskScore: 90,
        flagged: true,
        requiresConfirmation: true,
        summary: "Giao dịch có dấu hiệu rủi ro nghiêm trọng.",
        flags: [{ code: "UNUSUAL_NIGHT_HOUR", title: "Người nhận mới", detail: "Chuyển ban đêm", weight: 40 }],
        evaluatedAt: new Date().toISOString(),
      },
    });
    createOtpChallengeMock.mockResolvedValue({
      challengeId: "66666666-6666-4666-8666-666666666699",
      purpose: "TRANSFER",
      method: "TOTP",
      methods: ["TOTP"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    submitTransferMock.mockResolvedValue({
      transferId: "77777777-7777-4777-8777-777777777799",
      reference: "FT-CRITICAL-1",
      status: "SUCCEEDED",
      amount: { currency: "VND", amountMinor: "250000" },
      fee: { currency: "VND", amountMinor: "0" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    act(() => {
      renderer = create(<TransferScreen />);
    });
    await flushMicrotasks();

    const createQuoteButton = renderer!.root.findByProps({ testID: "transfer-create-quote" });
    await act(async () => {
      await createQuoteButton.props.onPress();
    });
    await flushMicrotasks();

    const confirmRiskCheckbox = renderer!.root.findByProps({ testID: "transfer-confirm-high-risk" });
    const reviewConfirmBefore = renderer!.root.findByProps({ testID: "transfer-review-confirm" });
    expect(reviewConfirmBefore.props.disabled).toBe(true);

    act(() => {
      confirmRiskCheckbox.props.onPress();
    });

    const reviewConfirmAfter = renderer!.root.findByProps({ testID: "transfer-review-confirm" });
    expect(reviewConfirmAfter.props.disabled).toBe(false);

    await act(async () => {
      await reviewConfirmAfter.props.onPress();
    });
    await flushMicrotasks();

    const otpInput = renderer!.root.findByProps({ testID: "transfer-step-up-code" });
    act(() => {
      otpInput.props.onChangeText("123456");
    });

    const submitButton = renderer!.root.findByProps({ testID: "transfer-submit" });
    await act(async () => {
      await submitButton.props.onPress();
    });
    await flushMicrotasks();

    expect(submitTransferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: "44444444-4444-4444-8444-444444444499",
        confirmHighRisk: true,
      }),
      expect.objectContaining({ auth: expect.objectContaining({ accessToken: "token-1" }) }),
    );
  });
});
