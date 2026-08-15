import * as SecureStore from "expo-secure-store";

import type { CreditPayment, CreditPaymentQuote } from "@/features/credit/types/credit";
import { isCreditPayment, isCreditPaymentQuote } from "@/features/credit/validation/creditResponseValidators";

const CREDIT_PAYMENT_INTENT_KEY = "banking.credit-payment.intent.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type PendingCardPaymentIntent = {
  userId: string;
  cardId: string;
  creditAccountId: string;
  statementId: string;
  idempotencyKey: string;
  quote: CreditPaymentQuote;
  createdAt: number;
  paymentId?: string;
  payment?: CreditPayment;
};

let mutationQueue: Promise<void> = Promise.resolve();

function enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPendingIntent(value: unknown): value is PendingCardPaymentIntent {
  return (
    isRecord(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.cardId) &&
    isNonEmptyString(value.creditAccountId) &&
    isNonEmptyString(value.statementId) &&
    isNonEmptyString(value.idempotencyKey) &&
    isCreditPaymentQuote(value.quote) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    value.createdAt > 0 &&
    (value.paymentId === undefined || isNonEmptyString(value.paymentId)) &&
    (value.payment === undefined || isCreditPayment(value.payment))
  );
}

function isQuoteExpired(quote: CreditPaymentQuote, now = Date.now()): boolean {
  const expiresAt = Date.parse(quote.expiresAt);
  return !Number.isFinite(expiresAt) || now >= expiresAt;
}

function parseIntent(value: string | null): PendingCardPaymentIntent | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPendingIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function clearInternal(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDIT_PAYMENT_INTENT_KEY, SECURE_STORE_OPTIONS);
}

export function saveCardPaymentIntent(intent: PendingCardPaymentIntent): Promise<void> {
  if (!isPendingIntent(intent)) return Promise.reject(new TypeError("Pending credit payment intent is invalid."));
  return enqueueMutation(async () => {
    await SecureStore.setItemAsync(CREDIT_PAYMENT_INTENT_KEY, JSON.stringify(intent), SECURE_STORE_OPTIONS);
  });
}

export function loadCardPaymentIntent(userId: string): Promise<PendingCardPaymentIntent | null> {
  if (!isNonEmptyString(userId)) return Promise.reject(new TypeError("userId must be non-empty."));
  return enqueueMutation(async () => {
    const storedValue = await SecureStore.getItemAsync(CREDIT_PAYMENT_INTENT_KEY, SECURE_STORE_OPTIONS);
    const intent = parseIntent(storedValue);
    if (!intent || intent.userId !== userId || isQuoteExpired(intent.quote)) {
      if (storedValue !== null) await clearInternal();
      return null;
    }
    return intent;
  });
}

export function clearCardPaymentIntent(): Promise<void> {
  return enqueueMutation(clearInternal);
}
