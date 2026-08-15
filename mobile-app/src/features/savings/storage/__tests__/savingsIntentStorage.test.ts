import * as SecureStore from "expo-secure-store";

import {
  clearSavingsIntent,
  loadSavingsIntent,
  saveSavingsIntent,
  type PendingSavingsIntent,
} from "@/features/savings/storage/savingsIntentStorage";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const KEY = "banking.savings.intent.v1";
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const intent: PendingSavingsIntent = {
  userId: "user-1",
  idempotencyKey: "savings-intent-1",
  quote: {
    quoteId: "quote-1",
    productId: "savings-vnd-1m",
    productName: "Tiết kiệm 1 tháng",
    termsVersion: "sandbox-v1",
    termMonths: 1,
    sourceAccountId: "account-1",
    sourceAccountMaskedNumber: "•••• 0001",
    principal: { currency: "VND", amountMinor: "1000000" },
    annualRateBasisPoints: 300,
    interestDays: 31,
    expectedInterest: { currency: "VND", amountMinor: "2547" },
    totalAtMaturity: { currency: "VND", amountMinor: "1002547" },
    openedAt: "2026-08-14T00:00:00Z",
    maturityAt: "2026-09-14T00:00:00Z",
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
    expiresAt: "2099-08-14T00:05:00Z",
  },
  createdAt: 1_700_000_000_000,
};

const deleteItemAsyncMock = jest.mocked(SecureStore.deleteItemAsync);
const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);

beforeEach(() => {
  jest.resetAllMocks();
  deleteItemAsyncMock.mockResolvedValue(undefined);
  setItemAsyncMock.mockResolvedValue(undefined);
  getItemAsyncMock.mockResolvedValue(null);
});

describe("savingsIntentStorage", () => {
  it("stores quote and idempotency key without step-up proof", async () => {
    await saveSavingsIntent(intent);
    expect(setItemAsyncMock).toHaveBeenCalledWith(KEY, JSON.stringify(intent), OPTIONS);
    expect(JSON.stringify(intent)).not.toContain("123456");
  });

  it("clears another user's intent and explicit logout cleanup", async () => {
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(intent));
    await expect(loadSavingsIntent("user-2")).resolves.toBeNull();
    await clearSavingsIntent();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
  });
});
