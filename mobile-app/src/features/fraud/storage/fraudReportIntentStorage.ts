import * as SecureStore from "expo-secure-store";

import { IntentRecoveryError } from "@/features/banking/storage/intentRecovery";
import { createSecureStoreScopedKey } from "@/features/banking/storage/secureStoreScope";
import type {
  FraudReportRequest,
  FraudReportResponse,
} from "@/features/fraud/types/fraudReport";
import { isFraudReportResponse } from "@/features/fraud/validation/fraudReportValidators";

const FRAUD_REPORT_INTENT_PREFIX = "banking.fraud-report.intent.v2";
const FRAUD_REPORT_INDEX_PREFIX = "banking.fraud-report.intent-index.v2";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const indexMutationQueue = new Map<string, Promise<void>>();

export type PendingFraudReportIntent = {
  userId: string;
  idempotencyKey: string;
  request: FraudReportRequest;
  createdAt: number;
  report?: FraudReportResponse;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function intentKey(
  userId: string,
  accountId: string,
  transactionId: string,
): Promise<string> {
  return createSecureStoreScopedKey(
    FRAUD_REPORT_INTENT_PREFIX,
    userId,
    accountId,
    transactionId,
  );
}

async function indexKey(userId: string): Promise<string> {
  return createSecureStoreScopedKey(FRAUD_REPORT_INDEX_PREFIX, userId);
}

function parseIndex(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (item): item is string =>
            typeof item === "string" &&
            new RegExp(`^${FRAUD_REPORT_INTENT_PREFIX}\\.[a-f0-9]{64}$`, "i").test(
              item,
            ),
        ),
      ),
    ];
  } catch {
    return [];
  }
}

function mutateIndex(
  storageIndexKey: string,
  mutation: () => Promise<void>,
): Promise<void> {
  const previous = indexMutationQueue.get(storageIndexKey) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(mutation);
  indexMutationQueue.set(storageIndexKey, operation);
  return operation.finally(() => {
    if (indexMutationQueue.get(storageIndexKey) === operation) {
      indexMutationQueue.delete(storageIndexKey);
    }
  });
}

async function addToIndex(userId: string, storageIntentKey: string): Promise<void> {
  const storageIndexKey = await indexKey(userId);
  await mutateIndex(storageIndexKey, async () => {
    const entries = parseIndex(
      await SecureStore.getItemAsync(storageIndexKey, SECURE_STORE_OPTIONS),
    );
    if (!entries.includes(storageIntentKey)) {
      await SecureStore.setItemAsync(
        storageIndexKey,
        JSON.stringify([...entries, storageIntentKey]),
        SECURE_STORE_OPTIONS,
      );
    }
  });
}

async function removeFromIndex(
  userId: string,
  storageIntentKey: string,
): Promise<void> {
  const storageIndexKey = await indexKey(userId);
  await mutateIndex(storageIndexKey, async () => {
    const entries = parseIndex(
      await SecureStore.getItemAsync(storageIndexKey, SECURE_STORE_OPTIONS),
    ).filter((entry) => entry !== storageIntentKey);
    if (entries.length === 0) {
      await SecureStore.deleteItemAsync(storageIndexKey, SECURE_STORE_OPTIONS);
      return;
    }
    await SecureStore.setItemAsync(
      storageIndexKey,
      JSON.stringify(entries),
      SECURE_STORE_OPTIONS,
    );
  });
}

function parseIntent(value: string | null): PendingFraudReportIntent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingFraudReportIntent>;
    if (
      !isNonEmptyString(parsed.userId) ||
      !isNonEmptyString(parsed.idempotencyKey) ||
      !parsed.request ||
      !isNonEmptyString(parsed.request.accountId) ||
      !isNonEmptyString(parsed.request.transactionId) ||
      !isNonEmptyString(parsed.request.reason) ||
      parsed.request.reason.trim().length < 5 ||
      parsed.request.reason.length > 1_000 ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      parsed.createdAt <= 0 ||
      (parsed.report !== undefined && !isFraudReportResponse(parsed.report))
    ) {
      return null;
    }
    return parsed as PendingFraudReportIntent;
  } catch {
    return null;
  }
}

export async function saveFraudReportIntent(
  intent: PendingFraudReportIntent,
): Promise<void> {
  if (!parseIntent(JSON.stringify(intent))) {
    throw new TypeError("Pending fraud report intent is invalid.");
  }
  const storageIntentKey = await intentKey(
    intent.userId,
    intent.request.accountId,
    intent.request.transactionId,
  );
  // Register the opaque key first. A crash here may leave a harmless stale
  // index entry, while an explicit owner-scoped cleanup can still discover
  // every successfully saved intent. Normal logout deliberately preserves it.
  await addToIndex(intent.userId, storageIntentKey);
  await SecureStore.setItemAsync(
    storageIntentKey,
    JSON.stringify(intent),
    SECURE_STORE_OPTIONS,
  );
}

export async function loadFraudReportIntent(
  userId: string,
  accountId: string,
  transactionId: string,
): Promise<PendingFraudReportIntent | null> {
  let stored: string | null;
  try {
    stored = await SecureStore.getItemAsync(
      await intentKey(userId, accountId, transactionId),
      SECURE_STORE_OPTIONS,
    );
  } catch {
    throw new IntentRecoveryError("READ_ERROR");
  }
  if (stored === null) return null;
  const intent = parseIntent(stored);
  if (!intent) {
    throw new IntentRecoveryError(
      "CORRUPT",
      "Dữ liệu báo cáo trước đó trên thiết bị không hợp lệ. Tạm thời chưa thể gửi lại để tránh tạo báo cáo trùng.",
    );
  }
  if (
    intent.userId !== userId ||
    intent.request.accountId !== accountId ||
    intent.request.transactionId !== transactionId
  ) {
    throw new IntentRecoveryError("CORRUPT");
  }
  return intent;
}

export async function clearFraudReportIntent(
  userId: string,
  accountId: string,
  transactionId: string,
): Promise<void> {
  const storageIntentKey = await intentKey(userId, accountId, transactionId);
  await SecureStore.deleteItemAsync(
    storageIntentKey,
    SECURE_STORE_OPTIONS,
  );
  await removeFromIndex(userId, storageIntentKey);
}

export async function clearFraudReportIntentsForUser(
  userId: string,
): Promise<void> {
  const storageIndexKey = await indexKey(userId);
  await mutateIndex(storageIndexKey, async () => {
    const entries = parseIndex(
      await SecureStore.getItemAsync(storageIndexKey, SECURE_STORE_OPTIONS),
    );
    const cleanup = await Promise.allSettled(
      entries.map((entry) =>
        SecureStore.deleteItemAsync(entry, SECURE_STORE_OPTIONS),
      ),
    );
    const failedEntries = entries.filter(
      (_entry, index) => cleanup[index]?.status === "rejected",
    );
    if (failedEntries.length > 0) {
      await SecureStore.setItemAsync(
        storageIndexKey,
        JSON.stringify(failedEntries),
        SECURE_STORE_OPTIONS,
      );
      throw new Error("Could not clear every fraud report recovery intent.");
    }
    await SecureStore.deleteItemAsync(storageIndexKey, SECURE_STORE_OPTIONS);
  });
}
