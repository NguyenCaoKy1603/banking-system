import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicOtpCodeGenerator,
  LocalDevelopmentKeyEncryptionAdapter,
  OtpDigestKeyring,
  buildTotpUri,
  generateTotp,
  validateTotp,
} from "../mfa/crypto.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("TOTP verifier matches RFC 6238 SHA-1 vectors", () => {
  const vectors: Array<[number, string]> = [
    [59_000, "94287082"],
    [1_111_111_109_000, "07081804"],
    [1_111_111_111_000, "14050471"],
    [1_234_567_890_000, "89005924"],
    [2_000_000_000_000, "69279037"],
  ];
  for (const [timestamp, expectedEightDigitToken] of vectors) {
    const token = generateTotp(RFC_SECRET, timestamp);
    // The production policy is six digits; the RFC's eight-digit vectors are
    // still asserted through the known six-digit suffix.
    assert.equal(token, expectedEightDigitToken.slice(-6));
    assert.equal(validateTotp(RFC_SECRET, token, timestamp, 1).valid, true);
  }
});

test("OTP digest is challenge-scoped and key-rotatable", () => {
  const keyring = new OtpDigestKeyring({
    current: { id: "current", value: Buffer.from("current-pepper-0123456789012345") },
    previous: { id: "previous", value: Buffer.from("previous-pepper-01234567890123") },
  });
  const digest = keyring.digest("challenge-a", "123456");
  assert.equal(keyring.verify("challenge-a", "123456", digest, "current"), true);
  assert.equal(keyring.verify("challenge-b", "123456", digest, "current"), false);
  assert.equal(keyring.verify("challenge-a", "123457", digest, "current"), false);
  const previousDigest = keyring.digest("challenge-a", "123456", "previous");
  assert.equal(keyring.verify("challenge-a", "123456", previousDigest, "previous"), true);
});

test("local envelope encryption does not expose plaintext in ciphertext", () => {
  const adapter = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "test-v1");
  const ciphertext = adapter.encrypt(RFC_SECRET);
  assert.equal(ciphertext.includes(RFC_SECRET), false);
  assert.equal(adapter.decrypt(ciphertext), RFC_SECRET);
  assert.throws(() => adapter.decrypt(ciphertext, "other-key"));
});

test("test code generator is explicit and six digits", () => {
  assert.equal(new DeterministicOtpCodeGenerator("123456").generate(), "123456");
  assert.throws(() => new DeterministicOtpCodeGenerator("12345"));
  assert.match(buildTotpUri(RFC_SECRET, "tester@example.com"), /^otpauth:\/\/totp\//);
});
