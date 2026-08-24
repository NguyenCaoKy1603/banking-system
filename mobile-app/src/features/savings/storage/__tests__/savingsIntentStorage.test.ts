import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  clearSavingsIntent,
  loadSavingsIntent,
  saveSavingsIntent,
  type PendingSavingsIntent,
} from "@/features/savings/storage/savingsIntentStorage";
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

const LEGACY_KEY = "banking.savings.intent.v1";
const SCOPED_PREFIX = "banking.savings.intent.v2.";
const mockStore = new Map<string, string>();
const intent: PendingSavingsIntent = {
  phase: "DRAFT_QUOTE",
  submitAttempted: false,
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

describe("savingsIntentStorage", () => {
  it("stores quote/idempotency state under a user-scoped key", async () => {
    await saveSavingsIntent(intent);
    expect(scopedKeys()).toHaveLength(1);
    expect(JSON.stringify(intent)).not.toContain("123456");
  });

  it("does not read or delete another user's intent", async () => {
    await saveSavingsIntent(intent);
    const userOneKey = scopedKeys()[0]!;

    await expect(loadSavingsIntent("user-2")).resolves.toBeNull();

    expect(mockStore.get(userOneKey)).toBe(JSON.stringify(intent));
  });

  it("migrates only a matching legacy record", async () => {
    const { phase: _phase, submitAttempted: _attempted, ...legacy } = intent;
    mockStore.set(LEGACY_KEY, JSON.stringify(legacy));
    await expect(loadSavingsIntent("user-1")).resolves.toMatchObject({
      phase: "DRAFT_QUOTE",
      submitAttempted: false,
    });
    expect(scopedKeys()).toHaveLength(1);
    expect(mockStore.has(LEGACY_KEY)).toBe(false);

    mockStore.clear();
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));
    await expect(loadSavingsIntent("user-2")).resolves.toBeNull();
    await clearSavingsIntent("user-2");
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("keeps the legacy record when the scoped migration write fails", async () => {
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));
    setItemAsyncMock.mockRejectedValueOnce(new Error("secure store unavailable"));

    await expect(loadSavingsIntent("user-1")).rejects.toThrow(
      "secure store unavailable",
    );
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("clears an expired draft but retains unknown and terminal outcomes", async () => {
    const expiredDraft: PendingSavingsIntent = {
      ...intent,
      quote: { ...intent.quote, expiresAt: "2000-01-01T00:00:00.000Z" },
    };
    await saveSavingsIntent(expiredDraft);
    await expect(loadSavingsIntent("user-1")).resolves.toBeNull();

    const expiredUnknown: PendingSavingsIntent = {
      ...expiredDraft,
      phase: "SUBMIT_UNKNOWN",
      submitAttempted: true,
    };
    await saveSavingsIntent(expiredUnknown);
    await expect(loadSavingsIntent("user-1")).resolves.toEqual(expiredUnknown);

    const terminal: PendingSavingsIntent = {
      ...expiredDraft,
      phase: "ACCEPTED_TERMINAL",
      submitAttempted: true,
      openingId: "opening-1",
      opening: {
        openingId: "opening-1",
        quoteId: intent.quote.quoteId,
        depositId: "deposit-1",
        status: "SUCCEEDED",
        reference: "SAV-1",
        failureReason: null,
        createdAt: "2026-08-23T00:00:00Z",
        updatedAt: "2026-08-23T00:00:01Z",
      },
    };
    await saveSavingsIntent(terminal);
    await expect(loadSavingsIntent("user-1")).resolves.toEqual(terminal);
  });

  it("fails closed and preserves a legacy opening whose operation id is missing or mismatched", async () => {
    const opening = {
      openingId: "opening-other",
      quoteId: intent.quote.quoteId,
      depositId: "deposit-1",
      status: "SUCCEEDED" as const,
      reference: "SAV-1",
      failureReason: null,
      createdAt: "2026-08-23T00:00:00Z",
      updatedAt: "2026-08-23T00:00:01Z",
    };
    const malformed = {
      ...intent,
      phase: "ACCEPTED_TERMINAL" as const,
      submitAttempted: true,
      openingId: "opening-1",
      opening,
    };

    await expect(saveSavingsIntent(malformed)).rejects.toThrow(TypeError);
    mockStore.set(LEGACY_KEY, JSON.stringify({ ...malformed, openingId: undefined }));

    await expect(loadSavingsIntent("user-1")).rejects.toBeInstanceOf(
      IntentRecoveryError,
    );
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("clears only the requested user's intent", async () => {
    await saveSavingsIntent(intent);
    await clearSavingsIntent("user-1");
    expect(scopedKeys()).toHaveLength(0);
  });
});
