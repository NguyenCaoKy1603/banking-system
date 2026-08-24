import * as Crypto from "expo-crypto";

function requireScopePart(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("SecureStore scope parts must be non-empty.");
  }
  return normalized;
}

export async function createSecureStoreScopedKey(
  prefix: string,
  ...scopeParts: string[]
): Promise<string> {
  const normalizedPrefix = requireScopePart(prefix);
  const normalizedScope = scopeParts.map(requireScopePart);
  if (normalizedScope.length === 0) {
    throw new TypeError("SecureStore scope requires at least one part.");
  }

  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(normalizedScope),
  );
  return `${normalizedPrefix}.${digest}`;
}
