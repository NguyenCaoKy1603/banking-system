import * as SecureStore from "expo-secure-store";

import type {
  SavingsOpening,
  SavingsQuote,
} from "@/features/savings/types/savings";
import {
  isSavingsOpening,
  isSavingsQuote,
} from "@/features/savings/validation/savingsResponseValidators";

const SAVINGS_INTENT_KEY = "banking.savings.intent.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type PendingSavingsIntent = {
  userId: string;
  idempotencyKey: string;
  quote: SavingsQuote;
  createdAt: number;
  openingId?: string;
  opening?: SavingsOpening;
};

let mutationQueue: Promise<void> = Promise.resolve();

function enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPendingSavingsIntent(value: unknown): value is PendingSavingsIntent {
  return (
    isRecord(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.idempotencyKey) &&
    isSavingsQuote(value.quote) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    value.createdAt > 0 &&
    (value.openingId === undefined || isNonEmptyString(value.openingId)) &&
    (value.opening === undefined || isSavingsOpening(value.opening))
  );
}

function parseIntent(value: string | null): PendingSavingsIntent | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isPendingSavingsIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isQuoteExpired(quote: SavingsQuote, now = Date.now()): boolean {
  const expiresAt = Date.parse(quote.expiresAt);
  return !Number.isFinite(expiresAt) || now >= expiresAt;
}

async function clearSavingsIntentInternal(): Promise<void> {
  await SecureStore.deleteItemAsync(SAVINGS_INTENT_KEY, SECURE_STORE_OPTIONS);
}

export function saveSavingsIntent(intent: PendingSavingsIntent): Promise<void> {
  if (!isPendingSavingsIntent(intent)) {
    return Promise.reject(new TypeError("Pending savings intent is invalid."));
  }
  return enqueueMutation(async () => {
    await SecureStore.setItemAsync(
      SAVINGS_INTENT_KEY,
      JSON.stringify(intent),
      SECURE_STORE_OPTIONS,
    );
  });
}

export function loadSavingsIntent(
  userId: string,
): Promise<PendingSavingsIntent | null> {
  if (!isNonEmptyString(userId)) {
    return Promise.reject(new TypeError("userId must be non-empty."));
  }
  return enqueueMutation(async () => {
    const storedValue = await SecureStore.getItemAsync(
      SAVINGS_INTENT_KEY,
      SECURE_STORE_OPTIONS,
    );
    const intent = parseIntent(storedValue);
    if (!intent || intent.userId !== userId || isQuoteExpired(intent.quote)) {
      if (storedValue !== null) {
        await clearSavingsIntentInternal();
      }
      return null;
    }
    return intent;
  });
}

export function clearSavingsIntent(): Promise<void> {
  return enqueueMutation(clearSavingsIntentInternal);
}
