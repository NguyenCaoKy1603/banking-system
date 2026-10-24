import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

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
import type {
  SavingsOpening,
  SavingsQuote,
} from "@/features/savings/types/savings";
import {
  isSavingsOpening,
  isSavingsQuote,
} from "@/features/savings/validation/savingsResponseValidators";

const LEGACY_SAVINGS_INTENT_KEY = "banking.savings.intent.v1";
const SAVINGS_INTENT_PREFIX = "banking.savings.intent.v2";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const inMemoryStore = new Map<string, string>();

function getWebStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

async function readStorageItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    const webStorage = getWebStorage();
    if (webStorage) {
      try {
        return webStorage.getItem(key);
      } catch {
        return inMemoryStore.get(key) ?? null;
      }
    }
    return inMemoryStore.get(key) ?? null;
  }
  return SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
}

async function writeStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    const webStorage = getWebStorage();
    if (webStorage) {
      try {
        webStorage.setItem(key, value);
        return;
      } catch {
        inMemoryStore.set(key, value);
        return;
      }
    }
    inMemoryStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
}

async function deleteStorageItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    const webStorage = getWebStorage();
    if (webStorage) {
      try {
        webStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    inMemoryStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
}

export type PendingSavingsIntent = ClientIntentLifecycle & {
  userId: string;
  idempotencyKey: string;
  quote: SavingsQuote;
  createdAt: number;
  manualReviewCode?: ManualReviewCode;
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

type ParsedIntent = {
  intent: PendingSavingsIntent;
  needsMigration: boolean;
};

function parseIntent(value: string | null): ParsedIntent | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      !isNonEmptyString(parsed.userId) ||
      !isNonEmptyString(parsed.idempotencyKey) ||
      !isSavingsQuote(parsed.quote) ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      parsed.createdAt <= 0 ||
      (parsed.manualReviewCode !== undefined &&
        !isManualReviewCode(parsed.manualReviewCode)) ||
      (parsed.openingId !== undefined && !isNonEmptyString(parsed.openingId)) ||
      (parsed.opening !== undefined && !isSavingsOpening(parsed.opening))
    ) {
      return null;
    }
    if (
      parsed.opening !== undefined &&
      (parsed.openingId === undefined ||
        parsed.opening.openingId !== parsed.openingId)
    ) {
      return null;
    }

    const acceptedPhase: AcceptedClientIntentPhase | null =
      parsed.opening !== undefined
        ? parsed.opening.status === "PENDING"
          ? "ACCEPTED_PENDING"
          : "ACCEPTED_TERMINAL"
        : parsed.openingId !== undefined
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
        idempotencyKey: parsed.idempotencyKey,
        quote: parsed.quote,
        createdAt: parsed.createdAt,
        ...(parsed.manualReviewCode === undefined
          ? {}
          : { manualReviewCode: parsed.manualReviewCode }),
        ...(parsed.openingId === undefined
          ? {}
          : { openingId: parsed.openingId }),
        ...(parsed.opening === undefined ? {} : { opening: parsed.opening }),
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

function isQuoteExpired(quote: SavingsQuote, now = Date.now()): boolean {
  const expiresAt = Date.parse(quote.expiresAt);
  return !Number.isFinite(expiresAt) || now >= expiresAt;
}

function getSavingsIntentKey(userId: string): Promise<string> {
  return createSecureStoreScopedKey(SAVINGS_INTENT_PREFIX, userId);
}

async function clearSavingsIntentInternal(key: string): Promise<void> {
  await deleteStorageItem(key);
}

export function saveSavingsIntent(intent: PendingSavingsIntent): Promise<void> {
  const parsedIntent = parseIntent(JSON.stringify(intent));
  if (!parsedIntent || parsedIntent.needsMigration) {
    return Promise.reject(new TypeError("Pending savings intent is invalid."));
  }
  return enqueueMutation(async () => {
    const key = await getSavingsIntentKey(intent.userId);
    await writeStorageItem(
      key,
      JSON.stringify(intent),
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
    const key = await getSavingsIntentKey(userId);
    let scopedValue: string | null;
    let storedValue: string | null;
    try {
      scopedValue = await readStorageItem(key);
      storedValue =
        scopedValue ??
        (await readStorageItem(LEGACY_SAVINGS_INTENT_KEY));
    } catch {
      throw new IntentRecoveryError("READ_ERROR");
    }
    const isLegacy = scopedValue === null && storedValue !== null;
    const parsed = parseIntent(storedValue);

    if (storedValue !== null && !parsed) {
      throw new IntentRecoveryError(
        "CORRUPT",
        "Dữ liệu khôi phục tiền gửi bị hỏng; chưa thể tạo yêu cầu mới an toàn.",
      );
    }

    if (!parsed) {
      return null;
    }

    if (
      (isQuoteExpired(parsed.intent.quote) &&
        canDiscardExpiredIntent(parsed.intent))
    ) {
      await clearSavingsIntentInternal(
        isLegacy ? LEGACY_SAVINGS_INTENT_KEY : key,
      );
      return null;
    }

    if (parsed.intent.userId !== userId) {
      if (isLegacy) return null;
      throw new IntentRecoveryError(
        "CORRUPT",
        "Dữ liệu khôi phục không khớp với người dùng hiện tại.",
      );
    }

    if (isLegacy || parsed.needsMigration) {
      await writeStorageItem(
        key,
        JSON.stringify(parsed.intent),
      );
      if (isLegacy) {
        await clearSavingsIntentInternal(LEGACY_SAVINGS_INTENT_KEY).catch(
          () => undefined,
        );
      }
    }
    return parsed.intent;
  });
}

export function clearSavingsIntent(userId: string): Promise<void> {
  if (!isNonEmptyString(userId)) {
    return Promise.reject(new TypeError("userId must be non-empty."));
  }

  return enqueueMutation(async () => {
    const key = await getSavingsIntentKey(userId);
    await clearSavingsIntentInternal(key);
    const legacyValue = await readStorageItem(LEGACY_SAVINGS_INTENT_KEY);
    const legacy = parseIntent(legacyValue);
    if (legacyValue !== null && (!legacy || legacy.intent.userId === userId)) {
      await clearSavingsIntentInternal(LEGACY_SAVINGS_INTENT_KEY);
    }
  });
}

export function resetSavingsIntentCacheForTests(): void {
  inMemoryStore.clear();
}
