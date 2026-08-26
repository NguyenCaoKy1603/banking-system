import {
  createHash,
  pbkdf2,
  pbkdf2Sync,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

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
