import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

import {
  clearFraudReportIntent,
  clearFraudReportIntentsForUser,
  loadFraudReportIntent,
  saveFraudReportIntent,
  type PendingFraudReportIntent,
} from "@/features/fraud/storage/fraudReportIntentStorage";
import { IntentRecoveryError } from "@/features/banking/storage/intentRecovery";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(),
}));

const USER_HASH = "a".repeat(64);
const INTENT_HASH = "b".repeat(64);
const OTHER_INTENT_HASH = "c".repeat(64);
const INDEX_KEY = `banking.fraud-report.intent-index.v2.${USER_HASH}`;
const KEY = `banking.fraud-report.intent.v2.${INTENT_HASH}`;
const OTHER_KEY = `banking.fraud-report.intent.v2.${OTHER_INTENT_HASH}`;
const OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const intent: PendingFraudReportIntent = {
  userId: "user-1",
  idempotencyKey: "fraud-intent-1",
  request: {
    accountId: "account-1",
    transactionId: "transaction-1",
    reason: "Tôi không thực hiện giao dịch này",
  },
  createdAt: 1_700_000_000_000,
};

const deleteItemAsyncMock = jest.mocked(SecureStore.deleteItemAsync);
const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);
const digestStringAsyncMock = jest.mocked(Crypto.digestStringAsync);

beforeEach(() => {
  jest.resetAllMocks();
  deleteItemAsyncMock.mockResolvedValue(undefined);
  getItemAsyncMock.mockResolvedValue(null);
  setItemAsyncMock.mockResolvedValue(undefined);
  digestStringAsyncMock.mockImplementation(async (_algorithm, value) => {
    if (value === JSON.stringify(["user-1"])) return USER_HASH;
    if (
      value ===
      JSON.stringify(["user-1", "account-1", "transaction-1"])
    ) {
      return INTENT_HASH;
    }
    return OTHER_INTENT_HASH;
  });
});

describe("fraudReportIntentStorage", () => {
  it("stores an indexed request under an opaque scoped key", async () => {
    await saveFraudReportIntent(intent);

    expect(setItemAsyncMock).toHaveBeenNthCalledWith(
      1,
      INDEX_KEY,
      JSON.stringify([KEY]),
      OPTIONS,
    );
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      KEY,
      JSON.stringify(intent),
      OPTIONS,
    );
    expect(KEY).not.toContain("user-1");
    expect(KEY).not.toContain("account-1");
    expect(KEY).not.toContain("transaction-1");
  });

  it("loads only the matching user, account and transaction", async () => {
    getItemAsyncMock
      .mockResolvedValueOnce(JSON.stringify(intent))
      .mockResolvedValueOnce(null);

    await expect(
      loadFraudReportIntent("user-1", "account-1", "transaction-1"),
    ).resolves.toEqual(intent);
    await expect(
      loadFraudReportIntent("user-2", "account-1", "transaction-1"),
    ).resolves.toBeNull();
  });

  it("keeps a valid durable server receipt", async () => {
    const accepted: PendingFraudReportIntent = {
      ...intent,
      report: {
        reportId: "report-1",
        status: "RECEIVED",
        createdAt: "2026-08-23T00:00:00.000Z",
      },
    };
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify(accepted));

    await expect(
      loadFraudReportIntent("user-1", "account-1", "transaction-1"),
    ).resolves.toEqual(accepted);
  });

  it("rejects malformed or unsafe intents before persistence", async () => {
    await expect(
      saveFraudReportIntent({
        ...intent,
        request: { ...intent.request, reason: "OTP" },
      }),
    ).rejects.toThrow(TypeError);
    expect(setItemAsyncMock).not.toHaveBeenCalled();

    getItemAsyncMock.mockResolvedValueOnce("not-json");
    await expect(
      loadFraudReportIntent("user-1", "account-1", "transaction-1"),
    ).rejects.toBeInstanceOf(IntentRecoveryError);
  });

  it("fails closed when SecureStore cannot read the durable request", async () => {
    getItemAsyncMock.mockRejectedValueOnce(new Error("keystore unavailable"));

    await expect(
      loadFraudReportIntent("user-1", "account-1", "transaction-1"),
    ).rejects.toMatchObject({
      kind: "READ_ERROR",
    });
  });

  it("clears only the scoped intent", async () => {
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify([KEY, OTHER_KEY]));
    await clearFraudReportIntent("user-1", "account-1", "transaction-1");

    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      INDEX_KEY,
      JSON.stringify([OTHER_KEY]),
      OPTIONS,
    );
  });

  it("clears every indexed intent for one user during logout", async () => {
    getItemAsyncMock.mockResolvedValueOnce(JSON.stringify([KEY, OTHER_KEY]));

    await clearFraudReportIntentsForUser("user-1");

    expect(deleteItemAsyncMock).toHaveBeenCalledWith(KEY, OPTIONS);
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(OTHER_KEY, OPTIONS);
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(INDEX_KEY, OPTIONS);
  });
});
