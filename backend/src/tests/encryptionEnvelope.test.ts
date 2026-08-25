import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { KeyEncryptionKeyringAdapter } from "../mfa/crypto.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";

function legacyMfa(key: Buffer, keyId: string, plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", keyId, nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function legacyEndpoint(keyMaterial: string, plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(keyMaterial).digest(), nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

test("MFA envelope binds ciphertext to context and supports previous-key decrypt", () => {
  const current = Buffer.alloc(32, 1);
  const previous = Buffer.alloc(32, 2);
  const keyring = new KeyEncryptionKeyringAdapter({ id: "mfa-v2", value: current }, [{ id: "mfa-v1", value: previous }]);
  const context = { environment: "preview", recordType: "mfa-totp", recordId: "credential-1", subjectId: "customer-1", schemaVersion: "026" };
  const ciphertext = keyring.encrypt("TOTP-SEED", context);
  assert.match(ciphertext, /^v2\.mfa-v2\./);
  assert.equal(keyring.decrypt(ciphertext, "mfa-v2", context), "TOTP-SEED");
  assert.throws(() => keyring.decrypt(ciphertext, "mfa-v2", { ...context, recordId: "credential-2" }), /context/);
  assert.equal(keyring.decrypt(legacyMfa(previous, "mfa-v1", "LEGACY-SEED"), "mfa-v1"), "LEGACY-SEED");
});

test("notification endpoint envelope supports legacy read and context tamper rejection", () => {
  const crypto = new EndpointCrypto("current-endpoint-secret", "endpoint-v2", { keyMaterial: "previous-endpoint-secret", id: "endpoint-v1" });
  const context = { environment: "preview", endpointId: "endpoint-1", customerId: "customer-1", schemaVersion: "026" };
  const ciphertext = crypto.encrypt("ExponentPushToken[test]", context);
  assert.match(ciphertext, /^v2\.endpoint-v2\./);
  assert.equal(crypto.decrypt(ciphertext, context), "ExponentPushToken[test]");
  assert.throws(() => crypto.decrypt(ciphertext, { ...context, customerId: "customer-2" }), /context/);
  assert.equal(crypto.decrypt(legacyEndpoint("previous-endpoint-secret", "legacy-address")), "legacy-address");
});
