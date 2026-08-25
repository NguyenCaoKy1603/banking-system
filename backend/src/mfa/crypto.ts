import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { Secret, TOTP } from "otpauth";

const AES_ALGORITHM = "aes-256-gcm";
const AES_NONCE_BYTES = 12;
const AES_TAG_BYTES = 16;
const OTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;

export type SecretKeyMaterial = {
  id: string;
  value: Buffer;
};

export interface KeyEncryptionPort {
  readonly keyId: string;
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string, keyId?: string): string;
}

function parseKey(value: string, name: string): Buffer {
  const normalized = value.trim();
  const encoded = normalized.startsWith("base64:")
    ? Buffer.from(normalized.slice("base64:".length), "base64")
    : normalized.startsWith("hex:")
      ? Buffer.from(normalized.slice("hex:".length), "hex")
      : Buffer.from(normalized, "base64");
  if (encoded.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes.`);
  }
  return encoded;
}

/** AES-256-GCM adapter used by local/preview deployments. */
export class LocalDevelopmentKeyEncryptionAdapter implements KeyEncryptionPort {
  readonly keyId: string;

  constructor(
    private readonly key: Buffer,
    keyId: string,
  ) {
    if (key.length !== 32) {
      throw new Error("MFA encryption key must be exactly 32 bytes.");
    }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
      throw new Error("MFA encryption key id is invalid.");
    }
    this.keyId = keyId;
  }

  static fromEnvironment(options: { required?: boolean } = {}): LocalDevelopmentKeyEncryptionAdapter {
    const configured = process.env.BANKING_MFA_ENCRYPTION_KEY?.trim();
    const keyId = process.env.BANKING_MFA_ENCRYPTION_KEY_ID?.trim() || "local-v1";
    if (!configured) {
      if (options.required ?? true) {
        throw new Error("BANKING_MFA_ENCRYPTION_KEY is required for MFA runtime.");
      }
      return new LocalDevelopmentKeyEncryptionAdapter(randomBytes(32), keyId);
    }
    return new LocalDevelopmentKeyEncryptionAdapter(
      parseKey(configured, "BANKING_MFA_ENCRYPTION_KEY"),
      keyId,
    );
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(AES_NONCE_BYTES);
    const cipher = createCipheriv(AES_ALGORITHM, this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", this.keyId, nonce.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  decrypt(ciphertext: string, keyId?: string): string {
    const [version, envelopeKeyId, nonceEncoded, tagEncoded, bodyEncoded] = ciphertext.split(".");
    if (version !== "v1" || envelopeKeyId !== (keyId ?? this.keyId)) {
      throw new Error("MFA ciphertext key id or version is invalid.");
    }
    const nonce = Buffer.from(nonceEncoded ?? "", "base64url");
    const tag = Buffer.from(tagEncoded ?? "", "base64url");
    const body = Buffer.from(bodyEncoded ?? "", "base64url");
    if (nonce.length !== AES_NONCE_BYTES || tag.length !== AES_TAG_BYTES || body.length === 0) {
      throw new Error("MFA ciphertext is invalid.");
    }
    const decipher = createDecipheriv(AES_ALGORITHM, this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }
}

export interface OtpCodeGenerator {
  generate(): string;
}

export class SecureOtpCodeGenerator implements OtpCodeGenerator {
  generate(): string {
    return String(randomInt(0, 1_000_000)).padStart(OTP_DIGITS, "0");
  }
}

export class DeterministicOtpCodeGenerator implements OtpCodeGenerator {
  constructor(private readonly code: string) {
    if (!/^\d{6}$/.test(code)) {
      throw new Error("Deterministic test OTP must contain six digits.");
    }
  }

  generate(): string {
    return this.code;
  }
}

export type OtpDigestKeyringOptions = {
  current: SecretKeyMaterial;
  previous?: SecretKeyMaterial;
};

/** Keyed OTP digest.  The challenge hash is part of the MAC domain. */
export class OtpDigestKeyring {
  private readonly keys: SecretKeyMaterial[];

  constructor(options: OtpDigestKeyringOptions) {
    if (options.current.value.length < 16) {
      throw new Error("OTP pepper must contain at least 128 bits.");
    }
    this.keys = [options.current, ...(options.previous ? [options.previous] : [])];
    if (new Set(this.keys.map((key) => key.id)).size !== this.keys.length) {
      throw new Error("OTP digest key ids must be unique.");
    }
  }

  static fromEnvironment(options: { required?: boolean } = {}): OtpDigestKeyring {
    const current = process.env.BANKING_OTP_PEPPER?.trim();
    const currentId = process.env.BANKING_OTP_PEPPER_KEY_ID?.trim() || "otp-v1";
    const previous = process.env.BANKING_OTP_PEPPER_PREVIOUS?.trim();
    const previousId = process.env.BANKING_OTP_PEPPER_PREVIOUS_KEY_ID?.trim();
    if (!current) {
      if (options.required ?? true) {
        throw new Error("BANKING_OTP_PEPPER is required for OTP runtime.");
      }
      return new OtpDigestKeyring({ current: { id: currentId, value: randomBytes(32) } });
    }
    return new OtpDigestKeyring({
      current: { id: currentId, value: parseKey(current, "BANKING_OTP_PEPPER") },
      ...(previous && previousId
        ? { previous: { id: previousId, value: parseKey(previous, "BANKING_OTP_PEPPER_PREVIOUS") } }
        : {}),
    });
  }

  digest(challengeHash: string, code: string, keyId = this.keys[0]!.id): string {
    const key = this.keys.find((candidate) => candidate.id === keyId);
    if (!key) {
      throw new Error("OTP digest key id is not configured.");
    }
    return createHmac("sha256", key.value)
      .update(`${challengeHash}:${code}`, "utf8")
      .digest("hex");
  }

  get currentKeyId(): string {
    return this.keys[0]!.id;
  }

  verify(challengeHash: string, code: string, expectedDigest: string, expectedKeyId?: string): boolean {
    const candidate = Buffer.from(expectedDigest, "hex");
    if (candidate.length !== 32) {
      return false;
    }
    const candidates = expectedKeyId
      ? this.keys.filter((key) => key.id === expectedKeyId)
      : this.keys;
    return candidates.some((key) => {
      const actual = Buffer.from(this.digest(challengeHash, code, key.id), "hex");
      return actual.length === candidate.length && timingSafeEqual(actual, candidate);
    });
  }
}

export type TotpValidation = {
  valid: boolean;
  timeStep: number | null;
};

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function createTotp(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: "Banking Reference",
    label,
    algorithm: "SHA1",
    digits: OTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function buildTotpUri(secretBase32: string, email: string): string {
  return createTotp(secretBase32, email).toString();
}

/** RFC 6238-compatible validation with a one-step backwards drift window. */
export function validateTotp(
  secretBase32: string,
  token: string,
  timestampMs: number,
  window = 1,
): TotpValidation {
  if (!/^\d{6}$/.test(token)) {
    return { valid: false, timeStep: null };
  }
  const totp = createTotp(secretBase32, "verification");
  const delta = totp.validate({ token, timestamp: timestampMs, window });
  if (delta === null || delta > 0) {
    return { valid: false, timeStep: null };
  }
  return {
    valid: true,
    timeStep: Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS) + delta,
  };
}

export function generateTotp(secretBase32: string, timestampMs: number): string {
  return createTotp(secretBase32, "fixture").generate({ timestamp: timestampMs });
}

export function totpTimeStep(timestampMs: number): number {
  return Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS);
}

export const MFA_TOTP_POLICY = Object.freeze({
  algorithm: "SHA1",
  digits: OTP_DIGITS,
  periodSeconds: TOTP_PERIOD_SECONDS,
  acceptedWindow: 1,
});
