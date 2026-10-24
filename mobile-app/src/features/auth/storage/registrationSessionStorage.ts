import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { isNonEmptyDateTime } from "@/services/api/responseValidators";

// ─── Constants ───────────────────────────────────────────────────────────────

const REGISTRATION_SESSION_KEY = "banking.registration.session.v1";
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

// ─── Schema v1 discriminated union ───────────────────────────────────────────

export type RegistrationSessionV1 =
  | {
      schemaVersion: 1;
      phase: "BEGIN_UNKNOWN";
      createdAt: string;
    }
  | {
      schemaVersion: 1;
      phase: "CHALLENGE_RECEIVED";
      challengeId: string;
      methods: ["EMAIL_OTP"];
      purpose: "REGISTRATION_EMAIL_VERIFY";
      expiresAt: string;
      resendAfter?: string;
      createdAt: string;
    };

// ─── Load result ─────────────────────────────────────────────────────────────

export type RegistrationSessionLoadResult =
  | { kind: "EMPTY" }
  | { kind: "VALID"; session: RegistrationSessionV1 }
  | { kind: "CORRUPT" };

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates a parsed record as a RegistrationSessionV1.
 * Rejects any unexpected fields beyond the canonical set.
 */
function isValidSession(value: unknown): value is RegistrationSessionV1 {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!isNonEmptyDateTime(value.createdAt)) return false;

  if (value.phase === "BEGIN_UNKNOWN") {
    // Only these keys are allowed
    const allowedKeys = new Set(["schemaVersion", "phase", "createdAt"]);
    if (!Object.keys(value).every((k) => allowedKeys.has(k))) return false;
    return true;
  }

  if (value.phase === "CHALLENGE_RECEIVED") {
    // Required fields
    if (!isNonEmptyString(value.challengeId)) return false;
    if (
      !Array.isArray(value.methods) ||
      value.methods.length !== 1 ||
      value.methods[0] !== "EMAIL_OTP"
    ) {
      return false;
    }
    if (value.purpose !== "REGISTRATION_EMAIL_VERIFY") return false;
    if (!isNonEmptyDateTime(value.expiresAt)) return false;

    // Optional field: resendAfter must be valid if present
    if (
      value.resendAfter !== undefined &&
      !isNonEmptyDateTime(value.resendAfter)
    ) {
      return false;
    }

    // Reject unexpected fields
    const allowedKeys = new Set([
      "schemaVersion",
      "phase",
      "challengeId",
      "methods",
      "purpose",
      "expiresAt",
      "resendAfter",
      "createdAt",
    ]);
    if (!Object.keys(value).every((k) => allowedKeys.has(k))) return false;

    return true;
  }

  return false;
}

// ─── Serializer ───────────────────────────────────────────────────────────────

/**
 * Serializes only the canonical keys for each phase, stripping any extras.
 */
function serializeSession(session: RegistrationSessionV1): string {
  if (session.phase === "BEGIN_UNKNOWN") {
    const canonical: Record<string, unknown> = {
      schemaVersion: session.schemaVersion,
      phase: session.phase,
      createdAt: session.createdAt,
    };
    return JSON.stringify(canonical);
  }

  // CHALLENGE_RECEIVED
  const canonical: Record<string, unknown> = {
    schemaVersion: session.schemaVersion,
    phase: session.phase,
    challengeId: session.challengeId,
    methods: session.methods,
    purpose: session.purpose,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
  };
  if (session.resendAfter !== undefined) {
    canonical.resendAfter = session.resendAfter;
  }
  return JSON.stringify(canonical);
}

// ─── Mutation queue ───────────────────────────────────────────────────────────

let mutationQueue: Promise<void> = Promise.resolve();

function enqueueMutation<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load the persisted registration session.
 *
 * - SecureStore read errors propagate (not mapped to CORRUPT).
 * - Missing key → EMPTY.
 * - Invalid JSON or schema mismatch → CORRUPT.
 */
export function loadRegistrationSession(): Promise<RegistrationSessionLoadResult> {
  return enqueueMutation(async () => {
    // Intentionally not caught: storage hardware/OS errors must propagate.
    const raw = await readStorageItem(REGISTRATION_SESSION_KEY);

    if (raw === null) {
      return { kind: "EMPTY" } as RegistrationSessionLoadResult;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValidSession(parsed)) {
        return { kind: "VALID", session: parsed };
      }
      return { kind: "CORRUPT" };
    } catch {
      return { kind: "CORRUPT" };
    }
  });
}

/**
 * Persist a registration session.
 * Only canonical keys are written; any extra fields are stripped.
 */
export function saveRegistrationSession(
  session: RegistrationSessionV1,
): Promise<void> {
  return enqueueMutation(async () => {
    await writeStorageItem(
      REGISTRATION_SESSION_KEY,
      serializeSession(session),
    );
  });
}

/**
 * Delete the persisted registration session.
 * The caller must check for errors; this function does NOT swallow them.
 */
export function deleteRegistrationSession(): Promise<void> {
  return enqueueMutation(async () => {
    await deleteStorageItem(REGISTRATION_SESSION_KEY);
  });
}

export function resetRegistrationSessionCacheForTests(): void {
  inMemoryStore.clear();
}
