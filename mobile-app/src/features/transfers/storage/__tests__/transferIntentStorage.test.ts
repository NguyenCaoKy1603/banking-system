import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  clearTransferIntent,
  loadTransferIntent,
  saveTransferIntent,
  type PendingTransferIntent,
} from "@/features/transfers/storage/transferIntentStorage";
import { IntentRecoveryError } from "@/features/banking/storage/intentRecovery";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(),
}));
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const LEGACY_KEY = "banking.transfer.intent.v1";
const SCOPED_PREFIX = "banking.transfer.intent.v2.";
const OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const mockStore = new Map<string, string>();

const intent: PendingTransferIntent = {
  phase: "DRAFT_QUOTE",
  submitAttempted: false,
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
const digestStringAsyncMock = jest.mocked(Crypto.digestStringAsync);
const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);

function mockDigest(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function scopedKeys(): string[] {
  return [...mockStore.keys()].filter((key) => key.startsWith(SCOPED_PREFIX));
}

beforeEach(() => {
  jest.resetAllMocks();
  mockStore.clear();
  digestStringAsyncMock.mockImplementation(async (_algorithm, value) => mockDigest(value));
  getItemAsyncMock.mockImplementation(async (key) => mockStore.get(key) ?? null);
  setItemAsyncMock.mockImplementation(async (key, value) => {
    mockStore.set(key, value);
  });
  deleteItemAsyncMock.mockImplementation(async (key) => {
    mockStore.delete(key);
  });
});

describe("transferIntentStorage", () => {
  it("stores an intent under a user-scoped SecureStore key", async () => {
    await saveTransferIntent(intent);

    expect(scopedKeys()).toHaveLength(1);
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      expect.stringMatching(/^banking\.transfer\.intent\.v2\./),
      JSON.stringify(intent),
      OPTIONS,
    );
  });

  it("loads only the current user's scoped intent without deleting another user", async () => {
    await saveTransferIntent(intent);
    const userOneKey = scopedKeys()[0]!;

    await expect(loadTransferIntent("user-1")).resolves.toEqual(intent);
    await expect(loadTransferIntent("user-2")).resolves.toBeNull();
    expect(mockStore.get(userOneKey)).toBe(JSON.stringify(intent));
  });

  it("migrates a matching legacy record after the new record is durable", async () => {
    const { phase: _phase, submitAttempted: _attempted, ...legacy } = intent;
    mockStore.set(
      LEGACY_KEY,
      JSON.stringify({ ...legacy, transferId: "transfer-1" }),
    );

    const loaded = await loadTransferIntent("user-1");

    expect(loaded).toMatchObject({
      phase: "ACCEPTED_PENDING",
      submitAttempted: true,
      transferId: "transfer-1",
    });
    expect(scopedKeys()).toHaveLength(1);
    expect(mockStore.has(LEGACY_KEY)).toBe(false);
  });

  it("keeps the legacy record when the scoped migration write fails", async () => {
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));
    setItemAsyncMock.mockRejectedValueOnce(new Error("secure store unavailable"));

    await expect(loadTransferIntent("user-1")).rejects.toThrow(
      "secure store unavailable",
    );
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("leaves another user's legacy record untouched", async () => {
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));

    await expect(loadTransferIntent("user-2")).resolves.toBeNull();
    await clearTransferIntent("user-2");

    expect(mockStore.get(LEGACY_KEY)).toBe(JSON.stringify(intent));
    expect(scopedKeys()).toHaveLength(0);
  });

  it("clears only an expired draft and keeps expired unknown outcomes", async () => {
    const expiredDraft: PendingTransferIntent = {
      ...intent,
      quote: { ...intent.quote, expiresAt: "2000-01-01T00:00:00.000Z" },
    };
    await saveTransferIntent(expiredDraft);
    await expect(loadTransferIntent("user-1")).resolves.toBeNull();
    expect(scopedKeys()).toHaveLength(0);

    const expiredUnknown: PendingTransferIntent = {
      ...expiredDraft,
      phase: "SUBMIT_UNKNOWN",
      submitAttempted: true,
    };
    await saveTransferIntent(expiredUnknown);
    await expect(loadTransferIntent("user-1")).resolves.toEqual(expiredUnknown);
  });

  it("migrates a stored terminal receipt to ACCEPTED_TERMINAL", async () => {
    const terminal = {
      ...intent,
      phase: "ACCEPTED_PENDING" as const,
      submitAttempted: true,
      transferId: "transfer-1",
      receipt: {
        transferId: "transfer-1",
        reference: "TRX-1",
        status: "SUCCEEDED" as const,
        amount: intent.quote.amount,
        fee: intent.quote.fee,
        createdAt: "2026-08-23T00:00:00Z",
        updatedAt: "2026-08-23T00:00:01Z",
      },
    };
    mockStore.set(LEGACY_KEY, JSON.stringify(terminal));

    await expect(loadTransferIntent("user-1")).resolves.toMatchObject({
      phase: "ACCEPTED_TERMINAL",
    });
  });

  it("fails closed and preserves a legacy receipt whose operation id is missing or mismatched", async () => {
    const receipt = {
      transferId: "transfer-other",
      reference: "TRX-1",
      status: "SUCCEEDED" as const,
      amount: intent.quote.amount,
      fee: intent.quote.fee,
      createdAt: "2026-08-23T00:00:00Z",
      updatedAt: "2026-08-23T00:00:01Z",
    };
    const malformed = {
      ...intent,
      phase: "ACCEPTED_TERMINAL" as const,
      submitAttempted: true,
      transferId: "transfer-1",
      receipt,
    };

    await expect(saveTransferIntent(malformed)).rejects.toThrow(TypeError);
    mockStore.set(LEGACY_KEY, JSON.stringify({ ...malformed, transferId: undefined }));

    await expect(loadTransferIntent("user-1")).rejects.toBeInstanceOf(
      IntentRecoveryError,
    );
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("clears only the requested user's scoped and matching legacy records", async () => {
    await saveTransferIntent(intent);
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));

    await clearTransferIntent("user-1");

    expect(scopedKeys()).toHaveLength(0);
    expect(mockStore.has(LEGACY_KEY)).toBe(false);
  });
});
