import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { createSecureStoreScopedKey } from "@/features/banking/storage/secureStoreScope";

const BIOMETRIC_CREDENTIAL_PREFIX = "banking.biometric.v1";
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type StoredBiometricCredential = {
  credentialId: string;
  userId: string;
  deviceId: string;
  biometricSecret: string;
  displayName: string;
  enrolledAt: string;
};

const webMemoryStore = new Map<string, StoredBiometricCredential>();
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

function isStoredBiometricCredential(
  value: unknown,
): value is StoredBiometricCredential {
  return (
    isRecord(value) &&
    isNonEmptyString(value.credentialId) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.deviceId) &&
    isNonEmptyString(value.biometricSecret) &&
    typeof value.displayName === "string" &&
    isNonEmptyString(value.enrolledAt)
  );
}

async function resolveStorageKey(userId: string, deviceId: string): Promise<string> {
  return createSecureStoreScopedKey(BIOMETRIC_CREDENTIAL_PREFIX, userId, deviceId);
}

export function saveBiometricCredential(
  record: StoredBiometricCredential,
): Promise<void> {
  if (!isStoredBiometricCredential(record)) {
    return Promise.reject(
      new TypeError("Biometric credential record is invalid."),
    );
  }

  return enqueueMutation(async () => {
    const storageKey = await resolveStorageKey(record.userId, record.deviceId);
    if (Platform.OS === "web") {
      webMemoryStore.set(storageKey, { ...record });
      return;
    }

    await SecureStore.setItemAsync(
      storageKey,
      JSON.stringify(record),
      SECURE_STORE_OPTIONS,
    );
  });
}

export function loadBiometricCredential(
  userId: string,
  deviceId: string,
): Promise<StoredBiometricCredential | null> {
  if (!isNonEmptyString(userId) || !isNonEmptyString(deviceId)) {
    return Promise.resolve(null);
  }

  return enqueueMutation(async () => {
    const storageKey = await resolveStorageKey(userId, deviceId);
    if (Platform.OS === "web") {
      const record = webMemoryStore.get(storageKey);
      return record ? { ...record } : null;
    }

    const raw = await SecureStore.getItemAsync(storageKey, SECURE_STORE_OPTIONS);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !isStoredBiometricCredential(parsed) ||
        parsed.userId !== userId.trim() ||
        parsed.deviceId !== deviceId.trim()
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });
}

export function clearBiometricCredential(
  userId: string,
  deviceId: string,
): Promise<void> {
  if (!isNonEmptyString(userId) || !isNonEmptyString(deviceId)) {
    return Promise.resolve();
  }

  return enqueueMutation(async () => {
    const storageKey = await resolveStorageKey(userId, deviceId);
    if (Platform.OS === "web") {
      webMemoryStore.delete(storageKey);
      return;
    }

    await SecureStore.deleteItemAsync(storageKey, SECURE_STORE_OPTIONS);
  });
}
