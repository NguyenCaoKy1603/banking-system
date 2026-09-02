import {
  createHash,
  createHmac,
  pbkdf2,
  pbkdf2Sync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";

function pbkdf2Async(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, 120_000, 32, "sha256", (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/**
 * IDs persisted by the reference boundary must be valid PostgreSQL UUIDs.
 * The prefix parameter is retained at call sites for readability while the
 * value itself stays database-compatible.
 */
export function createId(prefix: string): string {
  void prefix;
  return randomUUID();
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** @deprecated Use generateVerificationCode; retained for old test fixtures only. */
export const createSandboxOtp = generateVerificationCode;

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string, salt = randomBytes(16)): {
  salt: string;
  digest: string;
} {
  const digest = pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return { salt: salt.toString("hex"), digest };
}

export async function hashPasswordAsync(password: string, salt = randomBytes(16)): Promise<{
  salt: string;
  digest: string;
}> {
  const digest = (await pbkdf2Async(password, salt)).toString("hex");
  return { salt: salt.toString("hex"), digest };
}

export function verifyPassword(
  password: string,
  saltHex: string,
  expectedDigest: string,
): boolean {
  const actual = Buffer.from(
    hashPassword(password, Buffer.from(saltHex, "hex")).digest,
    "hex",
  );
  const expected = Buffer.from(expectedDigest, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function verifyPasswordAsync(
  password: string,
  saltHex: string,
  expectedDigest: string,
): Promise<boolean> {
  const actual = await pbkdf2Async(password, Buffer.from(saltHex, "hex"));
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const INTERNAL_SENTINEL = "missing-remote-address";
const DOMAIN_SEPARATION_PREFIX = "registration-rate-limit:v1:";

export function validateRegistrationFingerprintKey(
  value: string | undefined,
): Buffer {
  if (!value) {
    throw new Error("REGISTRATION_FINGERPRINT_KEY is required.");
  }
  if (!value.startsWith("base64:")) {
    throw new Error("REGISTRATION_FINGERPRINT_KEY must start with base64:");
  }
  const payload = value.slice("base64:".length);
  if (!payload) {
    throw new Error("REGISTRATION_FINGERPRINT_KEY payload cannot be empty.");
  }
  if (payload.length % 4 !== 0 || !BASE64_PATTERN.test(payload)) {
    throw new Error("REGISTRATION_FINGERPRINT_KEY must be valid standard Base64.");
  }
  const decoded = Buffer.from(payload, "base64");
  if (decoded.toString("base64") !== payload) {
    throw new Error("REGISTRATION_FINGERPRINT_KEY failed canonical round-trip validation.");
  }
  if (decoded.length < 32) {
    throw new Error("REGISTRATION_FINGERPRINT_KEY must decode to at least 32 bytes.");
  }
  if (decoded.every((byte) => byte === 0)) {
    throw new Error("REGISTRATION_FINGERPRINT_KEY cannot be an all-zero key.");
  }
  return decoded;
}

function normalizeRemoteAddress(remoteAddress: string | undefined): string {
  if (!remoteAddress) {
    return INTERNAL_SENTINEL;
  }
  let normalized = remoteAddress.trim().toLowerCase();
  if (!normalized) {
    return INTERNAL_SENTINEL;
  }
  if (normalized.startsWith("::ffff:")) {
    const candidate = normalized.slice("::ffff:".length);
    if (isIP(candidate) === 4) {
      normalized = candidate;
    }
  }
  if (isIP(normalized) === 0) {
    return INTERNAL_SENTINEL;
  }
  return normalized;
}

export function computeRegistrationNetworkFingerprint(
  remoteAddress: string | undefined,
  secretKey: Buffer,
): string {
  if (!Buffer.isBuffer(secretKey) || secretKey.length < 32) {
    throw new Error("secretKey must be a Buffer of at least 32 bytes.");
  }
  const normalizedAddress = normalizeRemoteAddress(remoteAddress);
  return createHmac("sha256", secretKey)
    .update(`${DOMAIN_SEPARATION_PREFIX}${normalizedAddress}`)
    .digest("hex");
}
