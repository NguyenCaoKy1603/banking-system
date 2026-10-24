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
import type { TransferQuote, TransferReceipt } from "@/features/transfers/types/transfer";
import { isTransferQuote, isTransferReceipt } from "@/features/transfers/validation/transferResponseValidators";

const LEGACY_TRANSFER_INTENT_KEY = "banking.transfer.intent.v1";
const TRANSFER_INTENT_PREFIX = "banking.transfer.intent.v2";
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

export type PendingTransferIntent = ClientIntentLifecycle & {
  userId: string;
  idempotencyKey: string;
  quote: TransferQuote;
  createdAt: number;
  manualReviewCode?: ManualReviewCode;
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

type ParsedIntent = {
  intent: PendingTransferIntent;
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
      !isTransferQuote(parsed.quote) ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      parsed.createdAt <= 0 ||
      (parsed.manualReviewCode !== undefined &&
        !isManualReviewCode(parsed.manualReviewCode)) ||
      (parsed.transferId !== undefined && !isNonEmptyString(parsed.transferId)) ||
      (parsed.receipt !== undefined && !isTransferReceipt(parsed.receipt))
    ) {
      return null;
    }
    if (
      parsed.receipt !== undefined &&
      (parsed.transferId === undefined ||
        parsed.receipt.transferId !== parsed.transferId)
    ) {
      return null;
    }

    const acceptedPhase: AcceptedClientIntentPhase | null =
      parsed.receipt !== undefined
        ? parsed.receipt.status === "PENDING"
          ? "ACCEPTED_PENDING"
          : "ACCEPTED_TERMINAL"
        : parsed.transferId !== undefined
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
        ...(parsed.transferId === undefined
          ? {}
          : { transferId: parsed.transferId }),
        ...(parsed.receipt === undefined ? {} : { receipt: parsed.receipt }),
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

function isQuoteExpired(quote: TransferQuote, now = Date.now()): boolean {
  const expiresAt = Date.parse(quote.expiresAt);
  return !Number.isFinite(expiresAt) || now >= expiresAt;
}

function getTransferIntentKey(userId: string): Promise<string> {
  return createSecureStoreScopedKey(TRANSFER_INTENT_PREFIX, userId);
}

async function clearTransferIntentInternal(key: string): Promise<void> {
  await deleteStorageItem(key);
}

export function saveTransferIntent(intent: PendingTransferIntent): Promise<void> {
  const parsedIntent = parseIntent(JSON.stringify(intent));
  if (!parsedIntent || parsedIntent.needsMigration) {
    return Promise.reject(new TypeError("Pending transfer intent is invalid."));
  }

  return enqueueMutation(async () => {
    const key = await getTransferIntentKey(intent.userId);
    await writeStorageItem(
      key,
      JSON.stringify(intent),
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
    const key = await getTransferIntentKey(userId);
    let scopedValue: string | null;
    let storedValue: string | null;
    try {
      scopedValue = await readStorageItem(key);
      storedValue =
        scopedValue ??
        (await readStorageItem(LEGACY_TRANSFER_INTENT_KEY));
    } catch {
      throw new IntentRecoveryError("READ_ERROR");
    }
    const isLegacy = scopedValue === null && storedValue !== null;
    const parsed = parseIntent(storedValue);

    if (storedValue !== null && !parsed) {
      throw new IntentRecoveryError(
        "CORRUPT",
        "Dữ liệu khôi phục giao dịch bị hỏng; chưa thể tạo yêu cầu mới an toàn.",
      );
    }

    if (!parsed) {
      return null;
    }

    if (
      isQuoteExpired(parsed.intent.quote) &&
      canDiscardExpiredIntent(parsed.intent)
    ) {
      await clearTransferIntentInternal(
        isLegacy ? LEGACY_TRANSFER_INTENT_KEY : key,
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
        await clearTransferIntentInternal(LEGACY_TRANSFER_INTENT_KEY).catch(
          () => undefined,
        );
      }
    }

    return parsed.intent;
  });
}

export function clearTransferIntent(userId: string): Promise<void> {
  if (!isNonEmptyString(userId)) {
    return Promise.reject(new TypeError("userId must be non-empty."));
  }

  return enqueueMutation(async () => {
    const key = await getTransferIntentKey(userId);
    await clearTransferIntentInternal(key);
    const legacyValue = await readStorageItem(LEGACY_TRANSFER_INTENT_KEY);
    const legacy = parseIntent(legacyValue);
    if (legacyValue !== null && (!legacy || legacy.intent.userId === userId)) {
      await clearTransferIntentInternal(LEGACY_TRANSFER_INTENT_KEY);
    }
  });
}

export function resetTransferIntentCacheForTests(): void {
  inMemoryStore.clear();
}
