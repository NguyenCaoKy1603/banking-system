import * as SecureStore from "expo-secure-store";

import {
  canDiscardExpiredIntent,
  normalizeClientIntentLifecycle,
  type AcceptedClientIntentPhase,
  type ClientIntentLifecycle,
} from "@/features/banking/domain/clientIntentLifecycle";
import {
  isManualReviewCode,
  type ManualReviewCode,
} from "@/features/banking/domain/submitFailure";
import { createSecureStoreScopedKey } from "@/features/banking/storage/secureStoreScope";
import { IntentRecoveryError } from "@/features/banking/storage/intentRecovery";
import type { CreditPayment, CreditPaymentQuote } from "@/features/credit/types/credit";
import { isCreditPayment, isCreditPaymentQuote } from "@/features/credit/validation/creditResponseValidators";

const LEGACY_CREDIT_PAYMENT_INTENT_KEY = "banking.credit-payment.intent.v1";
const CREDIT_PAYMENT_INTENT_PREFIX = "banking.credit-payment.intent.v2";
const CREDIT_PAYMENT_INDEX_PREFIX = "banking.credit-payment.intent-index.v2";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type PendingCardPaymentIntent = ClientIntentLifecycle & {
  userId: string;
  cardId: string;
  creditAccountId: string;
  statementId: string;
  idempotencyKey: string;
  quote: CreditPaymentQuote;
  createdAt: number;
  manualReviewCode?: ManualReviewCode;
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

function isQuoteExpired(quote: CreditPaymentQuote, now = Date.now()): boolean {
  const expiresAt = Date.parse(quote.expiresAt);
  return !Number.isFinite(expiresAt) || now >= expiresAt;
}

type ParsedIntent = {
  intent: PendingCardPaymentIntent;
  needsMigration: boolean;
};

function parseIntent(value: string | null): ParsedIntent | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      !isNonEmptyString(parsed.userId) ||
      !isNonEmptyString(parsed.cardId) ||
      !isNonEmptyString(parsed.creditAccountId) ||
      !isNonEmptyString(parsed.statementId) ||
      !isNonEmptyString(parsed.idempotencyKey) ||
      !isCreditPaymentQuote(parsed.quote) ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      parsed.createdAt <= 0 ||
      (parsed.manualReviewCode !== undefined &&
        !isManualReviewCode(parsed.manualReviewCode)) ||
      (parsed.paymentId !== undefined && !isNonEmptyString(parsed.paymentId)) ||
      (parsed.payment !== undefined && !isCreditPayment(parsed.payment))
    ) {
      return null;
    }
    if (
      parsed.quote.creditAccountId !== parsed.creditAccountId ||
      parsed.quote.statementId !== parsed.statementId ||
      (parsed.payment !== undefined &&
        (parsed.paymentId === undefined ||
          parsed.payment.paymentId !== parsed.paymentId))
    ) {
      return null;
    }

    const acceptedPhase: AcceptedClientIntentPhase | null =
      parsed.payment !== undefined
        ? parsed.payment.status === "PENDING"
          ? "ACCEPTED_PENDING"
          : "ACCEPTED_TERMINAL"
        : parsed.paymentId !== undefined
          ? "ACCEPTED_PENDING"
          : null;
    const lifecycle = normalizeClientIntentLifecycle(parsed, acceptedPhase);
    if (!lifecycle) {
      return null;
    }
    if (
      parsed.manualReviewCode !== undefined &&
      lifecycle.phase !== "SUBMIT_UNKNOWN"
    ) {
      return null;
    }

    return {
      intent: {
        userId: parsed.userId,
        cardId: parsed.cardId,
        creditAccountId: parsed.creditAccountId,
        statementId: parsed.statementId,
        idempotencyKey: parsed.idempotencyKey,
        quote: parsed.quote,
        createdAt: parsed.createdAt,
        ...(parsed.manualReviewCode === undefined
          ? {}
          : { manualReviewCode: parsed.manualReviewCode }),
        ...(parsed.paymentId === undefined
          ? {}
          : { paymentId: parsed.paymentId }),
        ...(parsed.payment === undefined ? {} : { payment: parsed.payment }),
        ...lifecycle,
      },
      needsMigration:
        parsed.phase !== lifecycle.phase ||
        parsed.submitAttempted !== lifecycle.submitAttempted,
    };
  } catch {
    return null;
  }
}

function getIntentKey(userId: string, cardId: string): Promise<string> {
  return createSecureStoreScopedKey(
    CREDIT_PAYMENT_INTENT_PREFIX,
    userId,
    cardId,
  );
}

function getIndexKey(userId: string): Promise<string> {
  return createSecureStoreScopedKey(CREDIT_PAYMENT_INDEX_PREFIX, userId);
}

function parseCardIndex(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(isNonEmptyString)
    ) {
      throw new TypeError("Credit payment intent index is invalid.");
    }
    return [...new Set(parsed)];
  } catch (error: unknown) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Credit payment intent index is invalid.");
  }
}

async function loadCardIndex(indexKey: string): Promise<string[]> {
  return parseCardIndex(
    await SecureStore.getItemAsync(indexKey, SECURE_STORE_OPTIONS),
  );
}

async function addCardToIndex(indexKey: string, cardId: string): Promise<void> {
  const cardIds = await loadCardIndex(indexKey);
  if (cardIds.includes(cardId)) return;
  await SecureStore.setItemAsync(
    indexKey,
    JSON.stringify([...cardIds, cardId]),
    SECURE_STORE_OPTIONS,
  );
}

async function removeCardFromIndex(
  indexKey: string,
  cardId: string,
): Promise<void> {
  const cardIds = await loadCardIndex(indexKey);
  const nextCardIds = cardIds.filter((candidate) => candidate !== cardId);
  if (nextCardIds.length === cardIds.length) return;
  if (nextCardIds.length === 0) {
    await SecureStore.deleteItemAsync(indexKey, SECURE_STORE_OPTIONS);
    return;
  }
  await SecureStore.setItemAsync(
    indexKey,
    JSON.stringify(nextCardIds),
    SECURE_STORE_OPTIONS,
  );
}

async function clearInternal(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
}

export function saveCardPaymentIntent(intent: PendingCardPaymentIntent): Promise<void> {
  const parsedIntent = parseIntent(JSON.stringify(intent));
  if (!parsedIntent || parsedIntent.needsMigration) return Promise.reject(new TypeError("Pending credit payment intent is invalid."));
  return enqueueMutation(async () => {
    const [key, indexKey] = await Promise.all([
      getIntentKey(intent.userId, intent.cardId),
      getIndexKey(intent.userId),
    ]);
    // Write the index first: if it fails, no untracked durable intent is made.
    await addCardToIndex(indexKey, intent.cardId);
    await SecureStore.setItemAsync(key, JSON.stringify(intent), SECURE_STORE_OPTIONS);
  });
}

export function loadCardPaymentIntent(
  userId: string,
  cardId: string,
): Promise<PendingCardPaymentIntent | null> {
  if (!isNonEmptyString(userId) || !isNonEmptyString(cardId)) {
    return Promise.reject(new TypeError("userId and cardId must be non-empty."));
  }
  return enqueueMutation(async () => {
    const [key, indexKey] = await Promise.all([
      getIntentKey(userId, cardId),
      getIndexKey(userId),
    ]);
    let scopedValue: string | null;
    let storedValue: string | null;
    try {
      scopedValue = await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
      storedValue =
        scopedValue ??
        (await SecureStore.getItemAsync(
          LEGACY_CREDIT_PAYMENT_INTENT_KEY,
          SECURE_STORE_OPTIONS,
        ));
    } catch {
      throw new IntentRecoveryError("READ_ERROR");
    }
    const isLegacy = scopedValue === null && storedValue !== null;
    const parsed = parseIntent(storedValue);

    if (storedValue !== null && !parsed) {
      throw new IntentRecoveryError(
        "CORRUPT",
        "Dữ liệu khôi phục thanh toán tín dụng bị hỏng; chưa thể tạo yêu cầu mới an toàn.",
      );
    }

    if (!parsed) {
      return null;
    }

    if (
      parsed.intent.userId !== userId ||
      parsed.intent.cardId !== cardId
    ) {
      if (isLegacy) return null;
      throw new IntentRecoveryError(
        "CORRUPT",
        "Dữ liệu khôi phục không khớp với thẻ hoặc người dùng hiện tại.",
      );
    }

    if (
      (isQuoteExpired(parsed.intent.quote) &&
        canDiscardExpiredIntent(parsed.intent))
    ) {
      await clearInternal(isLegacy ? LEGACY_CREDIT_PAYMENT_INTENT_KEY : key);
      if (!isLegacy) await removeCardFromIndex(indexKey, cardId);
      return null;
    }

    if (isLegacy || parsed.needsMigration) {
      await addCardToIndex(indexKey, cardId);
      await SecureStore.setItemAsync(
        key,
        JSON.stringify(parsed.intent),
        SECURE_STORE_OPTIONS,
      );
      if (isLegacy) {
        await clearInternal(LEGACY_CREDIT_PAYMENT_INTENT_KEY).catch(
          () => undefined,
        );
      }
    }
    return parsed.intent;
  });
}

export function clearCardPaymentIntent(
  userId: string,
  cardId: string,
): Promise<void> {
  if (!isNonEmptyString(userId) || !isNonEmptyString(cardId)) {
    return Promise.reject(new TypeError("userId and cardId must be non-empty."));
  }

  return enqueueMutation(async () => {
    const [key, indexKey] = await Promise.all([
      getIntentKey(userId, cardId),
      getIndexKey(userId),
    ]);
    await clearInternal(key);
    await removeCardFromIndex(indexKey, cardId);
    const legacyValue = await SecureStore.getItemAsync(
      LEGACY_CREDIT_PAYMENT_INTENT_KEY,
      SECURE_STORE_OPTIONS,
    );
    const legacy = parseIntent(legacyValue);
    if (
      legacyValue !== null &&
      legacy?.intent.userId === userId &&
      legacy.intent.cardId === cardId
    ) {
      await clearInternal(LEGACY_CREDIT_PAYMENT_INTENT_KEY);
    }
  });
}

export function clearCardPaymentIntentsForUser(userId: string): Promise<void> {
  if (!isNonEmptyString(userId)) {
    return Promise.reject(new TypeError("userId must be non-empty."));
  }

  return enqueueMutation(async () => {
    const indexKey = await getIndexKey(userId);
    const cardIds = await loadCardIndex(indexKey);
    const keys = await Promise.all(
      cardIds.map((cardId) => getIntentKey(userId, cardId)),
    );
    await Promise.all(keys.map((key) => clearInternal(key)));
    await clearInternal(indexKey);

    const legacyValue = await SecureStore.getItemAsync(
      LEGACY_CREDIT_PAYMENT_INTENT_KEY,
      SECURE_STORE_OPTIONS,
    );
    const legacy = parseIntent(legacyValue);
    if (
      legacyValue !== null &&
      (!legacy || legacy.intent.userId === userId)
    ) {
      await clearInternal(LEGACY_CREDIT_PAYMENT_INTENT_KEY);
    }
  });
}
