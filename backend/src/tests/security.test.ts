import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  computeRegistrationNetworkFingerprint,
  fingerprint,
  validateRegistrationFingerprintKey,
} from "../security.js";

const VALID_KEY_32 = Buffer.alloc(32, 1);
const VALID_KEY_32_BASE64 = `base64:${VALID_KEY_32.toString("base64")}`;
const VALID_KEY_64 = Buffer.alloc(64, 2);
const VALID_KEY_64_BASE64 = `base64:${VALID_KEY_64.toString("base64")}`;

test("T-B2-01: validateRegistrationFingerprintKey rejects key without base64: prefix", () => {
  assert.throws(
    () => validateRegistrationFingerprintKey(VALID_KEY_32.toString("base64")),
    /REGISTRATION_FINGERPRINT_KEY must start with base64:/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey(`hex:${"01".repeat(32)}`),
    /REGISTRATION_FINGERPRINT_KEY must start with base64:/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey("raw-secret-key-without-prefix-padding"),
    /REGISTRATION_FINGERPRINT_KEY must start with base64:/,
  );
});

test("T-B2-02: validateRegistrationFingerprintKey rejects invalid Base64 characters and whitespace", () => {
  assert.throws(
    () => validateRegistrationFingerprintKey("base64:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ-_"),
    /must be valid standard Base64/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey("base64:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ!*"),
    /must be valid standard Base64/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey("base64:AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ =="),
    /must be valid standard Base64/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey(` ${VALID_KEY_32_BASE64}`),
    /REGISTRATION_FINGERPRINT_KEY must start with base64:/,
  );
});

test("T-B2-03: validateRegistrationFingerprintKey rejects non-canonical round-trip / bad padding", () => {
  const nonCanonical = "base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=";
  assert.throws(
    () => validateRegistrationFingerprintKey(nonCanonical),
    /failed canonical round-trip validation/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey("base64:AQE"),
    /must be valid standard Base64/,
  );
});

test("T-B2-04: validateRegistrationFingerprintKey rejects decoded key under 32 bytes", () => {
  const key31 = `base64:${Buffer.alloc(31, 1).toString("base64")}`;
  assert.throws(
    () => validateRegistrationFingerprintKey(key31),
    /must decode to at least 32 bytes/,
  );
  const key1 = `base64:${Buffer.alloc(1, 1).toString("base64")}`;
  assert.throws(
    () => validateRegistrationFingerprintKey(key1),
    /must decode to at least 32 bytes/,
  );
});

test("T-B2-05: validateRegistrationFingerprintKey accepts valid canonical 32-byte key", () => {
  const result = validateRegistrationFingerprintKey(VALID_KEY_32_BASE64);
  assert.equal(Buffer.isBuffer(result), true);
  assert.equal(result.length, 32);
  assert.deepEqual(result, VALID_KEY_32);
});

test("T-B2-06: validateRegistrationFingerprintKey accepts valid canonical key over 32 bytes", () => {
  const result = validateRegistrationFingerprintKey(VALID_KEY_64_BASE64);
  assert.equal(Buffer.isBuffer(result), true);
  assert.equal(result.length, 64);
  assert.deepEqual(result, VALID_KEY_64);
});

test("T-B2-07: validateRegistrationFingerprintKey rejects canonical all-zero key", () => {
  const allZero32 = "base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  assert.throws(
    () => validateRegistrationFingerprintKey(allZero32),
    /cannot be an all-zero key/,
  );
  const allZero48 = `base64:${Buffer.alloc(48, 0).toString("base64")}`;
  assert.throws(
    () => validateRegistrationFingerprintKey(allZero48),
    /cannot be an all-zero key/,
  );
});

test("T-B2-08: validateRegistrationFingerprintKey rejects missing or empty key", () => {
  assert.throws(
    () => validateRegistrationFingerprintKey(undefined),
    /REGISTRATION_FINGERPRINT_KEY is required/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey(""),
    /REGISTRATION_FINGERPRINT_KEY is required/,
  );
  assert.throws(
    () => validateRegistrationFingerprintKey("base64:"),
    /payload cannot be empty/,
  );
});

test("T-B2-09: computeRegistrationNetworkFingerprint returns lowercase 64-char hex", () => {
  const fp = computeRegistrationNetworkFingerprint("192.168.1.100", VALID_KEY_32);
  assert.equal(typeof fp, "string");
  assert.equal(fp.length, 64);
  assert.match(fp, /^[0-9a-f]{64}$/);
});

test("T-B2-10: computeRegistrationNetworkFingerprint is deterministic for same key and address", () => {
  const fp1 = computeRegistrationNetworkFingerprint("10.0.0.1", VALID_KEY_32);
  const fp2 = computeRegistrationNetworkFingerprint("10.0.0.1", VALID_KEY_32);
  assert.equal(fp1, fp2);
});

test("T-B2-11: computeRegistrationNetworkFingerprint returns distinct output for distinct addresses", () => {
  const fp1 = computeRegistrationNetworkFingerprint("10.0.0.1", VALID_KEY_32);
  const fp2 = computeRegistrationNetworkFingerprint("10.0.0.2", VALID_KEY_32);
  assert.notEqual(fp1, fp2);
});

test("T-B2-12: computeRegistrationNetworkFingerprint returns distinct output for distinct keys", () => {
  const otherKey = Buffer.alloc(32, 2);
  const fp1 = computeRegistrationNetworkFingerprint("10.0.0.1", VALID_KEY_32);
  const fp2 = computeRegistrationNetworkFingerprint("10.0.0.1", otherKey);
  assert.notEqual(fp1, fp2);
});

test("T-B2-13: computeRegistrationNetworkFingerprint normalizes IPv4 and IPv4-mapped IPv6 to same fingerprint", () => {
  const fpIpv4 = computeRegistrationNetworkFingerprint("1.2.3.4", VALID_KEY_32);
  const fpMapped = computeRegistrationNetworkFingerprint("::ffff:1.2.3.4", VALID_KEY_32);
  assert.equal(fpIpv4, fpMapped);

  const fpLocal = computeRegistrationNetworkFingerprint("127.0.0.1", VALID_KEY_32);
  const fpMappedLocal = computeRegistrationNetworkFingerprint("::ffff:127.0.0.1", VALID_KEY_32);
  assert.equal(fpLocal, fpMappedLocal);
});

test("T-B2-14: computeRegistrationNetworkFingerprint normalizes IPv6 case to same fingerprint", () => {
  const fpLower = computeRegistrationNetworkFingerprint("2001:0db8:85a3::8a2e:0370:7334", VALID_KEY_32);
  const fpUpper = computeRegistrationNetworkFingerprint("2001:0DB8:85A3::8A2E:0370:7334", VALID_KEY_32);
  assert.equal(fpLower, fpUpper);
});

test("T-B2-15: computeRegistrationNetworkFingerprint maps malformed address to missing bucket", () => {
  const fpMissing = computeRegistrationNetworkFingerprint(undefined, VALID_KEY_32);
  const fpInvalid1 = computeRegistrationNetworkFingerprint("not-an-ip-address", VALID_KEY_32);
  const fpInvalid2 = computeRegistrationNetworkFingerprint("999.999.999.999", VALID_KEY_32);
  const fpInvalid3 = computeRegistrationNetworkFingerprint("::ffff:999.999.999.999", VALID_KEY_32);

  assert.equal(fpInvalid1, fpMissing);
  assert.equal(fpInvalid2, fpMissing);
  assert.equal(fpInvalid3, fpMissing);
});

test("T-B2-16: computeRegistrationNetworkFingerprint maps undefined, empty, and whitespace to missing bucket", () => {
  const fpUndefined = computeRegistrationNetworkFingerprint(undefined, VALID_KEY_32);
  const fpEmpty = computeRegistrationNetworkFingerprint("", VALID_KEY_32);
  const fpWhitespace = computeRegistrationNetworkFingerprint("   ", VALID_KEY_32);

  assert.equal(fpEmpty, fpUndefined);
  assert.equal(fpWhitespace, fpUndefined);
});

test("regression: shared fingerprint() behavior and output remain unchanged", () => {
  const testPayload = { foo: "bar", count: 42, active: true };
  const expected = createHash("sha256")
    .update(JSON.stringify(testPayload))
    .digest("hex");
  const actual = fingerprint(testPayload);
  assert.equal(actual, expected);
  assert.equal(actual.length, 64);
  assert.match(actual, /^[0-9a-f]{64}$/);
});

test("security: validation error messages never leak sensitive key values", () => {
  const canarySecret = "SUPER_SECRET_CANARY_VALUE_99999";
  assert.throws(
    () => validateRegistrationFingerprintKey(`base64:invalid-base64-${canarySecret}`),
    (err: Error) => {
      assert.equal(err.message.includes(canarySecret), false);
      return true;
    },
  );
});