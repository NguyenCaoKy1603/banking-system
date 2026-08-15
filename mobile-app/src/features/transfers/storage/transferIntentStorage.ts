import * as SecureStore from "expo-secure-store";

import type { TransferQuote, TransferReceipt } from "@/features/transfers/types/transfer";
import { isTransferQuote, isTransferReceipt } from "@/features/transfers/validation/transferResponseValidators";

const TRANSFER_INTENT_KEY = "banking.transfer.intent.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type PendingTransferIntent = {
  userId: string;
  idempotencyKey: string;
  quote: TransferQuote;
  createdAt: number;
  transferId?: string;
  receipt?: TransferReceipt;
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

function isPendingTransferIntent(value: unknown): value is PendingTransferIntent {
  return (
    isRecord(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.idempotencyKey) &&
    isTransferQuote(value.quote) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    value.createdAt > 0 &&
    (value.transferId === undefined || isNonEmptyString(value.transferId)) &&
    (value.receipt === undefined || isTransferReceipt(value.receipt))
  );
}

function parseIntent(value: string | null): PendingTransferIntent | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isPendingTransferIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isQuoteExpired(quote: TransferQuote, now = Date.now()): boolean {
  const expiresAt = Date.parse(quote.expiresAt);
  return !Number.isFinite(expiresAt) || now >= expiresAt;
}

async function clearTransferIntentInternal(): Promise<void> {
  await SecureStore.deleteItemAsync(TRANSFER_INTENT_KEY, SECURE_STORE_OPTIONS);
}

export function saveTransferIntent(intent: PendingTransferIntent): Promise<void> {
  if (!isPendingTransferIntent(intent)) {
    return Promise.reject(new TypeError("Pending transfer intent is invalid."));
  }

  return enqueueMutation(async () => {
    await SecureStore.setItemAsync(
      TRANSFER_INTENT_KEY,
      JSON.stringify(intent),
      SECURE_STORE_OPTIONS,
    );
  });
}

export function loadTransferIntent(
  userId: string,
): Promise<PendingTransferIntent | null> {
  if (!isNonEmptyString(userId)) {
    return Promise.reject(new TypeError("userId must be non-empty."));
  }

  return enqueueMutation(async () => {
    const storedValue = await SecureStore.getItemAsync(
      TRANSFER_INTENT_KEY,
      SECURE_STORE_OPTIONS,
    );
    const intent = parseIntent(storedValue);

    if (
      !intent ||
      intent.userId !== userId ||
      isQuoteExpired(intent.quote)
    ) {
      if (storedValue !== null) {
        await clearTransferIntentInternal();
      }
      return null;
    }

    return intent;
  });
}

export function clearTransferIntent(): Promise<void> {
  return enqueueMutation(clearTransferIntentInternal);
}
