import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  clearCardPaymentIntent,
  clearCardPaymentIntentsForUser,
  loadCardPaymentIntent,
  saveCardPaymentIntent,
  type PendingCardPaymentIntent,
} from "@/features/credit/storage/cardPaymentIntentStorage";
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

const LEGACY_KEY = "banking.credit-payment.intent.v1";
const INTENT_PREFIX = "banking.credit-payment.intent.v2.";
const INDEX_PREFIX = "banking.credit-payment.intent-index.v2.";
const mockStore = new Map<string, string>();
const intent: PendingCardPaymentIntent = {
  phase: "DRAFT_QUOTE",
  submitAttempted: false,
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

function keysWithPrefix(prefix: string): string[] {
  return [...mockStore.keys()].filter((key) => key.startsWith(prefix));
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

describe("cardPaymentIntentStorage", () => {
  it("stores separate intents per user and card with a logout index", async () => {
    const secondCard: PendingCardPaymentIntent = {
      ...intent,
      cardId: "card-2",
      idempotencyKey: "credit-intent-2",
    };

    await saveCardPaymentIntent(intent);
    await saveCardPaymentIntent(secondCard);

    expect(keysWithPrefix(INTENT_PREFIX)).toHaveLength(2);
    expect(keysWithPrefix(INDEX_PREFIX)).toHaveLength(1);
    await expect(loadCardPaymentIntent("user-1", "card-1")).resolves.toEqual(intent);
    await expect(loadCardPaymentIntent("user-1", "card-2")).resolves.toEqual(secondCard);
  });

  it("does not read or delete another user's/card's intent", async () => {
    await saveCardPaymentIntent(intent);
    const originalKeys = [...mockStore.keys()];

    await expect(loadCardPaymentIntent("user-2", "card-1")).resolves.toBeNull();
    await expect(loadCardPaymentIntent("user-1", "card-2")).resolves.toBeNull();

    expect([...mockStore.keys()].sort()).toEqual(originalKeys.sort());
  });

  it("migrates only a matching legacy record", async () => {
    const { phase: _phase, ...withoutPhase } = intent;
    mockStore.set(
      LEGACY_KEY,
      JSON.stringify({ ...withoutPhase, submitAttempted: true }),
    );

    await expect(loadCardPaymentIntent("user-1", "card-1")).resolves.toMatchObject({
      phase: "SUBMIT_UNKNOWN",
      submitAttempted: true,
    });
    expect(keysWithPrefix(INTENT_PREFIX)).toHaveLength(1);
    expect(keysWithPrefix(INDEX_PREFIX)).toHaveLength(1);
    expect(mockStore.has(LEGACY_KEY)).toBe(false);

    mockStore.clear();
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));
    await expect(loadCardPaymentIntent("user-1", "card-2")).resolves.toBeNull();
    await clearCardPaymentIntent("user-1", "card-2");
    await clearCardPaymentIntent("user-2", "card-1");
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("keeps the legacy record when a scoped migration write fails", async () => {
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));
    setItemAsyncMock
      .mockImplementationOnce(async (key, value) => {
        mockStore.set(key, value);
      })
      .mockRejectedValueOnce(new Error("secure store unavailable"));

    await expect(loadCardPaymentIntent("user-1", "card-1")).rejects.toThrow(
      "secure store unavailable",
    );
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("retains expired unknown and terminal payment outcomes", async () => {
    const expiredQuote = {
      ...intent.quote,
      expiresAt: "2000-01-01T00:00:00.000Z",
    };
    const unknown: PendingCardPaymentIntent = {
      ...intent,
      phase: "SUBMIT_UNKNOWN",
      submitAttempted: true,
      quote: expiredQuote,
    };
    await saveCardPaymentIntent(unknown);
    await expect(loadCardPaymentIntent("user-1", "card-1")).resolves.toEqual(unknown);

    const terminal: PendingCardPaymentIntent = {
      ...intent,
      phase: "ACCEPTED_TERMINAL",
      submitAttempted: true,
      quote: expiredQuote,
      paymentId: "payment-1",
      payment: {
        paymentId: "payment-1",
        statementId: intent.statementId,
        sourceAccountId: intent.quote.sourceAccountId,
        amount: intent.quote.amount,
        reference: "PAY-1",
        status: "SUCCEEDED",
        failureReason: null,
        createdAt: "2026-08-23T00:00:00Z",
        updatedAt: "2026-08-23T00:00:01Z",
      },
    };
    await saveCardPaymentIntent(terminal);
    await expect(loadCardPaymentIntent("user-1", "card-1")).resolves.toEqual(terminal);
  });

  it("rejects mismatched quote metadata and fails closed for payment operation ids", async () => {
    await expect(
      saveCardPaymentIntent({
        ...intent,
        creditAccountId: "credit-account-other",
      }),
    ).rejects.toThrow(TypeError);

    const malformed = {
      ...intent,
      phase: "ACCEPTED_TERMINAL" as const,
      submitAttempted: true,
      paymentId: "payment-1",
      payment: {
        paymentId: "payment-other",
        statementId: intent.statementId,
        sourceAccountId: intent.quote.sourceAccountId,
        amount: intent.quote.amount,
        reference: "PAY-1",
        status: "SUCCEEDED" as const,
        failureReason: null,
        createdAt: "2026-08-23T00:00:00Z",
        updatedAt: "2026-08-23T00:00:01Z",
      },
    };
    await expect(saveCardPaymentIntent(malformed)).rejects.toThrow(TypeError);
    mockStore.set(LEGACY_KEY, JSON.stringify(malformed));

    await expect(loadCardPaymentIntent("user-1", "card-1")).rejects.toBeInstanceOf(
      IntentRecoveryError,
    );
    expect(mockStore.has(LEGACY_KEY)).toBe(true);
  });

  it("clears one card without clearing another", async () => {
    const secondCard: PendingCardPaymentIntent = {
      ...intent,
      cardId: "card-2",
      idempotencyKey: "credit-intent-2",
    };
    await saveCardPaymentIntent(intent);
    await saveCardPaymentIntent(secondCard);

    await clearCardPaymentIntent("user-1", "card-1");

    await expect(loadCardPaymentIntent("user-1", "card-1")).resolves.toBeNull();
    await expect(loadCardPaymentIntent("user-1", "card-2")).resolves.toEqual(secondCard);
  });

  it("clears every indexed intent for one user during logout", async () => {
    await saveCardPaymentIntent(intent);
    await saveCardPaymentIntent({
      ...intent,
      cardId: "card-2",
      idempotencyKey: "credit-intent-2",
    });
    mockStore.set(LEGACY_KEY, JSON.stringify(intent));

    await clearCardPaymentIntentsForUser("user-1");

    expect(keysWithPrefix(INTENT_PREFIX)).toHaveLength(0);
    expect(keysWithPrefix(INDEX_PREFIX)).toHaveLength(0);
    expect(mockStore.has(LEGACY_KEY)).toBe(false);
  });
});
