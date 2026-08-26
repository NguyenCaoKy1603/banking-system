import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { Secret, TOTP } from "otpauth";

import type { SecretProvider, SecretReference } from "../secrets/SecretProvider.js";

const AES_ALGORITHM = "aes-256-gcm";
const AES_NONCE_BYTES = 12;
const AES_TAG_BYTES = 16;
const OTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const ENVELOPE_VERSION = "v2";
const AAD_VERSION = "aad-v1";

export type SecretKeyMaterial = {
  id: string;
  value: Buffer;
};

export type EncryptionContext = {
  environment?: string;
  recordType?: string;
  recordId?: string;
  subjectId?: string;
  schemaVersion?: string;
};

export interface KeyEncryptionPort {
  readonly keyId: string;
  encrypt(plaintext: string, context?: EncryptionContext): string;
  decrypt(ciphertext: string, keyId?: string, context?: EncryptionContext): string;
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

function normalizeContext(context?: EncryptionContext): Buffer {
  const values = [
    context?.environment?.trim() || "local",
    context?.recordType?.trim() || "unspecified",
    context?.recordId?.trim() || "unspecified",
    context?.subjectId?.trim() || "unspecified",
    context?.schemaVersion?.trim() || "v2",
  ];
  if (values.some((value) => value.includes("|"))) throw new Error("Encryption context contains an invalid separator.");
  return Buffer.from(values.join("|"), "utf8");
}

function decryptWithKey(key: Buffer, ciphertext: string, expectedKeyId: string | undefined, context: EncryptionContext | undefined, label: string): string {
  const parts = ciphertext.split(".");
  const version = parts[0];
  if (version === "v1") {
    const [, legacyKeyId, nonceEncoded, tagEncoded, bodyEncoded] = parts;
    if (!legacyKeyId || legacyKeyId !== (expectedKeyId ?? legacyKeyId)) throw new Error(`${label} ciphertext key id or version is invalid.`);
    const nonce = Buffer.from(nonceEncoded ?? "", "base64url");
    const tag = Buffer.from(tagEncoded ?? "", "base64url");
    const body = Buffer.from(bodyEncoded ?? "", "base64url");
    if (nonce.length !== AES_NONCE_BYTES || tag.length !== AES_TAG_BYTES || body.length === 0) throw new Error(`${label} ciphertext is invalid.`);
    const decipher = createDecipheriv(AES_ALGORITHM, key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }
  const [, envelopeKeyId, aadVersion, aadDigestEncoded, wrapNonceEncoded, wrapTagEncoded, wrappedDekEncoded, dataNonceEncoded, dataTagEncoded, bodyEncoded] = parts;
  if (version !== ENVELOPE_VERSION || !envelopeKeyId || envelopeKeyId !== (expectedKeyId ?? envelopeKeyId) || aadVersion !== AAD_VERSION) {
    throw new Error(`${label} ciphertext key id or version is invalid.`);
  }
  const aad = normalizeContext(context);
  const expectedDigest = createHash("sha256").update(aad).digest().subarray(0, 16).toString("base64url");
  if (aadDigestEncoded !== expectedDigest) throw new Error(`${label} ciphertext context is invalid.`);
  const wrapNonce = Buffer.from(wrapNonceEncoded ?? "", "base64url");
  const wrapTag = Buffer.from(wrapTagEncoded ?? "", "base64url");
  const wrappedDek = Buffer.from(wrappedDekEncoded ?? "", "base64url");
  const dataNonce = Buffer.from(dataNonceEncoded ?? "", "base64url");
  const dataTag = Buffer.from(dataTagEncoded ?? "", "base64url");
  const body = Buffer.from(bodyEncoded ?? "", "base64url");
  if ([wrapNonce, wrapTag, wrappedDek, dataNonce, dataTag].some((value) => value.length === 0) || body.length === 0) {
    throw new Error(`${label} ciphertext is invalid.`);
  }
  const unwrap = createDecipheriv(AES_ALGORITHM, key, wrapNonce);
  unwrap.setAAD(aad);
  unwrap.setAuthTag(wrapTag);
  const dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);
  if (dek.length !== 32) throw new Error(`${label} ciphertext data key is invalid.`);
  const decipher = createDecipheriv(AES_ALGORITHM, dek, dataNonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(dataTag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

function encryptWithKey(key: Buffer, keyId: string, plaintext: string, context: EncryptionContext | undefined): string {
  const aad = normalizeContext(context);
  const aadDigest = createHash("sha256").update(aad).digest().subarray(0, 16).toString("base64url");
  const dek = randomBytes(32);
  const wrapNonce = randomBytes(AES_NONCE_BYTES);
  const wrap = createCipheriv(AES_ALGORITHM, key, wrapNonce);
  wrap.setAAD(aad);
  const wrappedDek = Buffer.concat([wrap.update(dek), wrap.final()]);
  const wrapTag = wrap.getAuthTag();
  const dataNonce = randomBytes(AES_NONCE_BYTES);
  const data = createCipheriv(AES_ALGORITHM, dek, dataNonce);
  data.setAAD(aad);
  const body = Buffer.concat([data.update(plaintext, "utf8"), data.final()]);
  const dataTag = data.getAuthTag();
  return [ENVELOPE_VERSION, keyId, AAD_VERSION, aadDigest, wrapNonce.toString("base64url"), wrapTag.toString("base64url"), wrappedDek.toString("base64url"), dataNonce.toString("base64url"), dataTag.toString("base64url"), body.toString("base64url")].join(".");
}

function validateKey(key: Buffer, keyId: string, label: string): void {
  if (key.length !== 32) throw new Error(`${label} must be exactly 32 bytes.`);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error(`${label} key id is invalid.`);
}

/** AES-256-GCM local envelope adapter. A managed KMS adapter can implement the same port later. */
export class LocalDevelopmentKeyEncryptionAdapter implements KeyEncryptionPort {
  readonly keyId: string;

  constructor(private readonly key: Buffer, keyId: string) {
    validateKey(key, keyId, "MFA encryption");
    this.keyId = keyId;
  }

  static fromEnvironment(options: { required?: boolean } = {}): LocalDevelopmentKeyEncryptionAdapter {
    const configured = process.env.BANKING_MFA_ENCRYPTION_KEY?.trim();
    const keyId = process.env.BANKING_MFA_ENCRYPTION_KEY_ID?.trim() || "local-v1";
    if (!configured) {
      if (options.required ?? true) throw new Error("BANKING_MFA_ENCRYPTION_KEY is required for MFA runtime.");
      return new LocalDevelopmentKeyEncryptionAdapter(randomBytes(32), keyId);
    }
    return new LocalDevelopmentKeyEncryptionAdapter(parseKey(configured, "BANKING_MFA_ENCRYPTION_KEY"), keyId);
  }

  encrypt(plaintext: string, context?: EncryptionContext): string {
    return encryptWithKey(this.key, this.keyId, plaintext, context);
  }

  decrypt(ciphertext: string, keyId?: string, context?: EncryptionContext): string {
    return decryptWithKey(this.key, ciphertext, keyId, context, "MFA");
  }
}

/** Current-key writer with previous-key decrypt support for no-downtime rotation. */
export class KeyEncryptionKeyringAdapter implements KeyEncryptionPort {
  readonly keyId: string;
  private readonly keys: SecretKeyMaterial[];

  constructor(current: SecretKeyMaterial, previous: SecretKeyMaterial[] = []) {
    validateKey(current.value, current.id, "MFA encryption");
    for (const key of previous) validateKey(key.value, key.id, "MFA encryption");
    this.keys = [current, ...previous];
    if (new Set(this.keys.map((key) => key.id)).size !== this.keys.length) throw new Error("MFA encryption key ids must be unique.");
    this.keyId = current.id;
  }

  static fromEnvironment(options: { required?: boolean } = {}): KeyEncryptionKeyringAdapter {
    const current = process.env.BANKING_MFA_ENCRYPTION_KEY?.trim();
    const currentId = process.env.BANKING_MFA_ENCRYPTION_KEY_ID?.trim() || "mfa-v1";
    if (!current) {
      if (options.required ?? true) throw new Error("BANKING_MFA_ENCRYPTION_KEY is required for MFA runtime.");
      return new KeyEncryptionKeyringAdapter({ id: currentId, value: randomBytes(32) });
    }
    const previous = process.env.BANKING_MFA_ENCRYPTION_KEY_PREVIOUS?.trim();
    const previousId = process.env.BANKING_MFA_ENCRYPTION_KEY_PREVIOUS_ID?.trim();
    return new KeyEncryptionKeyringAdapter(
      { id: currentId, value: parseKey(current, "BANKING_MFA_ENCRYPTION_KEY") },
      previous && previousId ? [{ id: previousId, value: parseKey(previous, "BANKING_MFA_ENCRYPTION_KEY_PREVIOUS") }] : [],
    );
  }

  static async fromSecretProvider(
    provider: SecretProvider,
    references: { current: SecretReference; previous?: SecretReference },
    options: { currentKeyId?: string; previousKeyId?: string; required?: boolean } = {},
  ): Promise<KeyEncryptionKeyringAdapter> {
    const current = await provider.getSecret(references.current);
    const currentKeyId = options.currentKeyId?.trim() || current.version;
    let previous: SecretKeyMaterial[] = [];
    if (references.previous) {
      try {
        const previousValue = await provider.getSecret(references.previous);
        previous = [{ id: options.previousKeyId?.trim() || previousValue.version, value: parseKey(previousValue.value, references.previous.secretId) }];
      } catch (error) {
        if (options.required) throw error;
      }
    }
    return new KeyEncryptionKeyringAdapter(
      { id: currentKeyId, value: parseKey(current.value, references.current.secretId) },
      previous,
    );
  }

  encrypt(plaintext: string, context?: EncryptionContext): string {
    return encryptWithKey(this.keys[0]!.value, this.keys[0]!.id, plaintext, context);
  }

  decrypt(ciphertext: string, keyId?: string, context?: EncryptionContext): string {
    const envelopeKeyId = ciphertext.split(".")[1];
    const requested = keyId ?? envelopeKeyId;
    const key = this.keys.find((candidate) => candidate.id === requested);
    if (!key) throw new Error("MFA ciphertext key id is not configured.");
    return decryptWithKey(key.value, ciphertext, requested, context, "MFA");
  }

  get previousKeyIds(): readonly string[] {
    return this.keys.slice(1).map((key) => key.id);
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

  static async fromSecretProvider(
    provider: SecretProvider,
    references: { current: SecretReference; previous?: SecretReference },
    options: { currentKeyId?: string; previousKeyId?: string; required?: boolean } = {},
  ): Promise<OtpDigestKeyring> {
    const current = await provider.getSecret(references.current);
    let previous: SecretKeyMaterial | undefined;
    if (references.previous) {
      try {
        const previousValue = await provider.getSecret(references.previous);
        previous = { id: options.previousKeyId?.trim() || previousValue.version, value: parseKey(previousValue.value, references.previous.secretId) };
      } catch (error) {
        if (options.required) throw error;
      }
    }
    return new OtpDigestKeyring({
      current: { id: options.currentKeyId?.trim() || current.version, value: parseKey(current.value, references.current.secretId) },
      ...(previous ? { previous } : {}),
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
