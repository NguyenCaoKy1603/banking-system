import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import type { AuthUser } from "@/features/auth/types/auth";
import type { AuthSession } from "@/features/auth/types/session";
import { isAuthUser } from "@/features/auth/validation/authDataValidators";

const AUTH_SESSION_KEY = "banking.auth.session.v2";
const LEGACY_ACCESS_TOKEN_KEY = "banking.auth.access-token.v1";
const LEGACY_REFRESH_TOKEN_KEY = "banking.auth.refresh-token.v1";
const LEGACY_METADATA_KEY = "banking.auth.metadata.v1";
const LEGACY_KEYS = [
  LEGACY_ACCESS_TOKEN_KEY,
  LEGACY_REFRESH_TOKEN_KEY,
  LEGACY_METADATA_KEY,
] as const;
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type AuthSessionMetadata = {
  user: AuthUser;
  accessTokenExpiresAt: number;
};

let mutationQueue: Promise<void> = Promise.resolve();
let inMemoryAuthSession: AuthSession | null = null;

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

function isNonEmptyToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAuthSessionMetadata(value: unknown): value is AuthSessionMetadata {
  return (
    isRecord(value) &&
    isAuthUser(value.user) &&
    typeof value.accessTokenExpiresAt === "number" &&
    Number.isFinite(value.accessTokenExpiresAt) &&
    value.accessTokenExpiresAt > 0
  );
}

function isAuthSession(value: unknown): value is AuthSession {
  return (
    isRecord(value) &&
    isNonEmptyToken(value.accessToken) &&
    isNonEmptyToken(value.refreshToken) &&
    isNonEmptyToken(value.sessionEpoch) &&
    isAuthSessionMetadata({
      user: value.user,
      accessTokenExpiresAt: value.accessTokenExpiresAt,
    })
  );
}

type ParsedAuthSession = {
  session: AuthSession;
  needsMigration: boolean;
};

function parseAuthSession(value: string | null): ParsedAuthSession | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return null;
    }

    if (
      parsed.sessionEpoch !== undefined &&
      !isNonEmptyToken(parsed.sessionEpoch)
    ) {
      return null;
    }

    const sessionEpoch = isNonEmptyToken(parsed.sessionEpoch)
      ? parsed.sessionEpoch
      : Crypto.randomUUID();
    const session = { ...parsed, sessionEpoch };

    return isAuthSession(session)
      ? { session, needsMigration: parsed.sessionEpoch === undefined }
      : null;
  } catch {
    return null;
  }
}

function parseLegacyMetadata(value: string | null): AuthSessionMetadata | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isAuthSessionMetadata(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteKeys(keys: readonly string[]): Promise<void> {
  await Promise.all(
    keys.map((key) => SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS)),
  );
}

async function clearLegacyKeysBestEffort(): Promise<void> {
  try {
    await deleteKeys(LEGACY_KEYS);
  } catch {
    // The v2 record is already durable. A later cleanup can remove old keys.
  }
}

async function loadLegacyAuthSession(): Promise<{
  session: AuthSession | null;
  hasLegacyData: boolean;
}> {
  const [accessToken, refreshToken, metadataValue] = await Promise.all([
    SecureStore.getItemAsync(LEGACY_ACCESS_TOKEN_KEY, SECURE_STORE_OPTIONS),
    SecureStore.getItemAsync(LEGACY_REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS),
    SecureStore.getItemAsync(LEGACY_METADATA_KEY, SECURE_STORE_OPTIONS),
  ]);
  const metadata = parseLegacyMetadata(metadataValue);
  const hasLegacyData =
    accessToken !== null || refreshToken !== null || metadataValue !== null;

  if (!isNonEmptyToken(accessToken) || !isNonEmptyToken(refreshToken) || !metadata) {
    return { hasLegacyData, session: null };
  }

  return {
    hasLegacyData,
    session: {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: metadata.accessTokenExpiresAt,
      sessionEpoch: Crypto.randomUUID(),
      user: metadata.user,
    },
  };
}

export function saveAuthSession(session: AuthSession): Promise<void> {
  if (
    !isRecord(session) ||
    !isNonEmptyToken(session.accessToken) ||
    !isNonEmptyToken(session.refreshToken)
  ) {
    return Promise.reject(
      new TypeError("Auth session tokens must be non-empty strings."),
    );
  }

  if (!isAuthSession(session)) {
    return Promise.reject(new TypeError("Auth session metadata is invalid."));
  }

  return enqueueMutation(async () => {
    if (Platform.OS === "web") {
      inMemoryAuthSession = session;
      return;
    }

    // One SecureStore record keeps tokens and metadata consistent across writes.
    await SecureStore.setItemAsync(
      AUTH_SESSION_KEY,
      JSON.stringify(session),
      SECURE_STORE_OPTIONS,
    );
    await clearLegacyKeysBestEffort();
  });
}

export function loadAuthSession(): Promise<AuthSession | null> {
  return enqueueMutation(async () => {
    if (Platform.OS === "web") {
      return inMemoryAuthSession;
    }

    const storedValue = await SecureStore.getItemAsync(
      AUTH_SESSION_KEY,
      SECURE_STORE_OPTIONS,
    );
    const parsed = parseAuthSession(storedValue);

    if (storedValue !== null) {
      if (!parsed) {
        await clearAuthSessionInternal();
        return null;
      }

      if (parsed.needsMigration) {
        await SecureStore.setItemAsync(
          AUTH_SESSION_KEY,
          JSON.stringify(parsed.session),
          SECURE_STORE_OPTIONS,
        );
      }

      return parsed.session;
    }

    // Migrate sessions written by the previous three-key implementation.
    const legacy = await loadLegacyAuthSession();

    if (legacy.session) {
      await SecureStore.setItemAsync(
        AUTH_SESSION_KEY,
        JSON.stringify(legacy.session),
        SECURE_STORE_OPTIONS,
      );
      await clearLegacyKeysBestEffort();
      return legacy.session;
    }

    if (legacy.hasLegacyData) {
      await clearLegacyKeysBestEffort();
    }

    return null;
  });
}

async function clearAuthSessionInternal(): Promise<void> {
  await deleteKeys([AUTH_SESSION_KEY, ...LEGACY_KEYS]);
}

export function clearAuthSession(): Promise<void> {
  return enqueueMutation(async () => {
    if (Platform.OS === "web") {
      inMemoryAuthSession = null;
      return;
    }

    await clearAuthSessionInternal();
  });
}
