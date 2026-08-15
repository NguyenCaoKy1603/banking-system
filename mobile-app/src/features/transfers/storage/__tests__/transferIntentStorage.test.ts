import * as SecureStore from "expo-secure-store";

import {
  clearTransferIntent,
  loadTransferIntent,
  saveTransferIntent,
  type PendingTransferIntent,
} from "@/features/transfers/storage/transferIntentStorage";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const KEY = "banking.transfer.intent.v1";
const OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const intent: PendingTransferIntent = {
  userId: "user-1",
  idempotencyKey: "transfer-intent-1",
  quote: {
    quoteId: "quote-1",
    sourceAccountId: "account-1",
    beneficiary: {
      id: "beneficiary-1",
      displayName: "Recipient",
      maskedAccountNumber: "****9876",
      bankName: "Test bank",
      status: "ACTIVE",
    },
    amount: { currency: "VND", amountMinor: "100000" },
    fee: { currency: "VND", amountMinor: "1000" },
    totalDebit: { currency: "VND", amountMinor: "101000" },
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

describe("transferIntentStorage", () => {
  it("stores an intent as one atomic SecureStore record", async () => {
    await saveTransferIntent(intent);

    expect(setItemAsyncMock).toHaveBeenCalledWith(
      KEY,
      JSON.stringify(intent),
      OPTIONS,
    );
  });

  it("loads an intent for the same user", async () => {
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(intent));

    await expect(loadTransferIntent("user-1")).resolves.toEqual(intent);
  });

  it("does not expose another user's intent", async () => {
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(intent));

    await expect(loadTransferIntent("user-2")).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
  });

  it("clears malformed or expired intents", async () => {
    getItemAsyncMock.mockResolvedValueOnce("not-json");

    await expect(loadTransferIntent("user-1")).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
  });

  it("clears an intent explicitly", async () => {
    await clearTransferIntent();

    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
  });
});
