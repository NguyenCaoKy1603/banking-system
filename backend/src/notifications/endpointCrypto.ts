import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { SecretProvider, SecretReference } from "../secrets/SecretProvider.js";

const AES_ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const ENVELOPE_VERSION = "v2";
const AAD_VERSION = "aad-v1";

export type EndpointEncryptionContext = {
  environment?: string;
  endpointId?: string;
  customerId?: string;
  schemaVersion?: string;
};

type EndpointKey = { id: string; value: Buffer };

function normalizeContext(context?: EndpointEncryptionContext): Buffer {
  const values = [
    context?.environment?.trim() || "local",
    "notification-endpoint",
    context?.endpointId?.trim() || "unspecified",
    context?.customerId?.trim() || "unspecified",
    context?.schemaVersion?.trim() || "v2",
  ];
  if (values.some((value) => value.includes("|"))) throw new Error("Endpoint encryption context is invalid.");
  return Buffer.from(values.join("|"), "utf8");
}

function normalizeKeyId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) throw new Error("Notification endpoint encryption key id is invalid.");
  return normalized;
}

function keyMaterial(value: string): Buffer {
  if (!value.trim()) throw new Error("NOTIFICATION_ENDPOINT_ENCRYPTION_KEY is required for notification endpoints.");
  return createHash("sha256").update(value).digest();
}

function encryptV2(key: EndpointKey, value: string, context?: EndpointEncryptionContext): string {
  const aad = normalizeContext(context);
  const digest = createHash("sha256").update(aad).digest().subarray(0, 16).toString("base64url");
  const dek = randomBytes(32);
  const wrapNonce = randomBytes(NONCE_BYTES);
  const wrap = createCipheriv(AES_ALGORITHM, key.value, wrapNonce);
  wrap.setAAD(aad);
  const wrappedDek = Buffer.concat([wrap.update(dek), wrap.final()]);
  const wrapTag = wrap.getAuthTag();
  const dataNonce = randomBytes(NONCE_BYTES);
  const data = createCipheriv(AES_ALGORITHM, dek, dataNonce);
  data.setAAD(aad);
  const ciphertext = Buffer.concat([data.update(value, "utf8"), data.final()]);
  const dataTag = data.getAuthTag();
  return [ENVELOPE_VERSION, key.id, AAD_VERSION, digest, wrapNonce.toString("base64url"), wrapTag.toString("base64url"), wrappedDek.toString("base64url"), dataNonce.toString("base64url"), dataTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptV2(key: EndpointKey, value: string, context?: EndpointEncryptionContext): string {
  const [, envelopeKeyId, aadVersion, digest, wrapNonceEncoded, wrapTagEncoded, wrappedDekEncoded, dataNonceEncoded, dataTagEncoded, ciphertextEncoded] = value.split(".");
  if (!envelopeKeyId || aadVersion !== AAD_VERSION || envelopeKeyId !== key.id) throw new Error("Endpoint ciphertext key id or version is invalid.");
  const aad = normalizeContext(context);
  const expectedDigest = createHash("sha256").update(aad).digest().subarray(0, 16).toString("base64url");
  if (digest !== expectedDigest) throw new Error("Endpoint ciphertext context is invalid.");
  const wrapNonce = Buffer.from(wrapNonceEncoded ?? "", "base64url");
  const wrapTag = Buffer.from(wrapTagEncoded ?? "", "base64url");
  const wrappedDek = Buffer.from(wrappedDekEncoded ?? "", "base64url");
  const dataNonce = Buffer.from(dataNonceEncoded ?? "", "base64url");
  const dataTag = Buffer.from(dataTagEncoded ?? "", "base64url");
  const ciphertext = Buffer.from(ciphertextEncoded ?? "", "base64url");
  if ([wrapNonce, wrapTag, wrappedDek, dataNonce, dataTag, ciphertext].some((part) => part.length === 0)) throw new Error("Endpoint ciphertext is invalid.");
  const unwrap = createDecipheriv(AES_ALGORITHM, key.value, wrapNonce);
  unwrap.setAAD(aad);
  unwrap.setAuthTag(wrapTag);
  const dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);
  if (dek.length !== 32) throw new Error("Endpoint ciphertext data key is invalid.");
  const decipher = createDecipheriv(AES_ALGORITHM, dek, dataNonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(dataTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function decryptLegacy(key: EndpointKey, value: string): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error("Endpoint ciphertext is invalid.");
  const decipher = createDecipheriv(AES_ALGORITHM, key.value, Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Versioned local envelope encryption with legacy read and keyring support. */
export class EndpointCrypto {
  private readonly keys: EndpointKey[];

  constructor(keyMaterialInput = process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY, currentId = process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_ID?.trim() || "endpoint-v1", previous?: { keyMaterial: string; id: string }) {
    if (!keyMaterialInput?.trim()) throw new Error("NOTIFICATION_ENDPOINT_ENCRYPTION_KEY is required for notification endpoints.");
    this.keys = [{ id: normalizeKeyId(currentId), value: keyMaterial(keyMaterialInput) }];
    if (previous) this.keys.push({ id: normalizeKeyId(previous.id), value: keyMaterial(previous.keyMaterial) });
    if (new Set(this.keys.map((key) => key.id)).size !== this.keys.length) throw new Error("Notification endpoint encryption key ids must be unique.");
  }

  static fromEnvironment(options: { required?: boolean } = {}): EndpointCrypto {
    const current = process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY?.trim();
    if (!current) {
      if (options.required ?? true) throw new Error("NOTIFICATION_ENDPOINT_ENCRYPTION_KEY is required for notification endpoints.");
      return new EndpointCrypto(randomBytes(32).toString("base64url"), "endpoint-local-v1");
    }
    const previous = process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_PREVIOUS?.trim();
    const previousId = process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_PREVIOUS_ID?.trim();
    return new EndpointCrypto(current, process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_ID?.trim() || "endpoint-v1", previous && previousId ? { keyMaterial: previous, id: previousId } : undefined);
  }

  static async fromSecretProvider(
    provider: SecretProvider,
    references: { current: SecretReference; previous?: SecretReference },
    options: { currentKeyId?: string; previousKeyId?: string; required?: boolean } = {},
  ): Promise<EndpointCrypto> {
    const current = await provider.getSecret(references.current);
    let previous: { keyMaterial: string; id: string } | undefined;
    if (references.previous) {
      try {
        const previousValue = await provider.getSecret(references.previous);
        previous = { keyMaterial: previousValue.value, id: options.previousKeyId?.trim() || previousValue.version };
      } catch (error) {
        if (options.required) throw error;
      }
    }
    return new EndpointCrypto(current.value, options.currentKeyId?.trim() || current.version, previous);
  }

  get keyId(): string { return this.keys[0]!.id; }

  get previousKeyIds(): readonly string[] { return this.keys.slice(1).map((key) => key.id); }

  encrypt(value: string, context?: EndpointEncryptionContext): string {
    return encryptV2(this.keys[0]!, value, context);
  }

  decrypt(value: string, context?: EndpointEncryptionContext, requestedKeyId?: string): string {
    if (value.startsWith(`${ENVELOPE_VERSION}.`)) {
      const envelopeKeyId = value.split(".")[1];
      const key = this.keys.find((candidate) => candidate.id === (requestedKeyId ?? envelopeKeyId));
      if (!key) throw new Error("Endpoint ciphertext key id is not configured.");
      return decryptV2(key, value, context);
    }
    for (const key of this.keys) {
      try { return decryptLegacy(key, value); } catch { /* try the next rotation key */ }
    }
    throw new Error("Endpoint ciphertext could not be decrypted.");
  }
}
