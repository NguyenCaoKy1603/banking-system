import * as SecureStore from "expo-secure-store";

import {
  clearCardPaymentIntent,
  loadCardPaymentIntent,
  saveCardPaymentIntent,
  type PendingCardPaymentIntent,
} from "@/features/credit/storage/cardPaymentIntentStorage";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const KEY = "banking.credit-payment.intent.v1";
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const intent: PendingCardPaymentIntent = {
  userId: "user-1",
  cardId: "card-1",
  creditAccountId: "credit-account-1",
  statementId: "statement-1",
  idempotencyKey: "credit-intent-1",
  quote: {
    quoteId: "quote-1",
    sourceAccountId: "account-1",
    sourceAccountMaskedNumber: "•••• 0001",
    creditAccountId: "credit-account-1",
    cardLastFour: "2468",
    statementId: "statement-1",
    statementVersion: 1,
    paymentOption: "MINIMUM",
    amount: { currency: "VND", amountMinor: "200000" },
    fee: { currency: "VND", amountMinor: "0" },
    outstandingBefore: { currency: "VND", amountMinor: "4000000" },
    outstandingAfter: { currency: "VND", amountMinor: "3800000" },
    minimumPaymentRemainingBefore: { currency: "VND", amountMinor: "200000" },
    minimumPaymentRemainingAfter: { currency: "VND", amountMinor: "0" },
    terms: "Sandbox terms",
    expiresAt: "2099-08-24T17:05:00.000Z",
  },
  createdAt: 1_700_000_000_000,
};

const deleteItemAsyncMock = jest.mocked(SecureStore.deleteItemAsync);
const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);

beforeEach(() => {
  jest.resetAllMocks();
  deleteItemAsyncMock.mockResolvedValue(undefined);
  getItemAsyncMock.mockResolvedValue(null);
  setItemAsyncMock.mockResolvedValue(undefined);
});

describe("cardPaymentIntentStorage", () => {
  it("stores quote/idempotency state without OTP or other step-up proof", async () => {
    await saveCardPaymentIntent(intent);
    expect(setItemAsyncMock).toHaveBeenCalledWith(KEY, JSON.stringify(intent), OPTIONS);
    expect(JSON.stringify(intent)).not.toContain("proof");
  });

  it("loads only the same user's unexpired intent", async () => {
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(intent));
    await expect(loadCardPaymentIntent("user-1")).resolves.toEqual(intent);

    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(intent));
    await expect(loadCardPaymentIntent("user-2")).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
  });

  it("clears malformed and expired intents", async () => {
    getItemAsyncMock.mockResolvedValueOnce("not-json");
    await expect(loadCardPaymentIntent("user-1")).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);

    const expired = { ...intent, quote: { ...intent.quote, expiresAt: "2000-01-01T00:00:00.000Z" } };
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(expired));
    await expect(loadCardPaymentIntent("user-1")).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
  });

  it("clears the intent explicitly", async () => {
    await clearCardPaymentIntent();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
  });
});
