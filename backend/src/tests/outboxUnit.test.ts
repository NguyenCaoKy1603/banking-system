import assert from "node:assert/strict";
import test from "node:test";

import { classifyProviderError, ProviderError } from "../outbox/errorClassifier.js";
import {
  assertSafePayload,
  buildEnvelope,
  canonicalEventName,
  resolveEventPolicy,
  sanitizePayload,
  validateEnvelope,
} from "../outbox/eventRegistry.js";
import { fullJitterDelayMs, parseRetryAfter } from "../outbox/retryPolicy.js";

test("event registry canonicalizes aliases and validates a versioned envelope", () => {
  const policy = resolveEventPolicy("TRANSFER_SUCCEEDED");
  assert.ok(policy);
  assert.equal(canonicalEventName(policy), "transfer.succeeded.v1");
  const envelope = buildEnvelope({
    eventId: "00000000-0000-4000-8000-000000000001",
    eventType: "TRANSFER_SUCCEEDED",
    aggregateId: "00000000-0000-4000-8000-000000000002",
    aggregateVersion: 3,
    occurredAt: "2026-08-24T00:00:00.000Z",
    subjectCustomerIds: ["00000000-0000-4000-8000-000000000003"],
  });
  assert.equal(envelope.eventType, "transfer.succeeded.v1");
  assert.equal(validateEnvelope(envelope).aggregate.version, 3);
  assert.equal(resolveEventPolicy("transfer.succeeded", 99), null);
});

test("event payload redaction rejects credentials and sensitive identifiers", () => {
  assert.throws(() => assertSafePayload({ accessToken: "secret" }), /UNSAFE_EVENT_PAYLOAD/);
  assert.throws(() => assertSafePayload({ nested: [{ cvv: "123" }] }), /UNSAFE_EVENT_PAYLOAD/);
  assert.throws(() => validateEnvelope({}), /EVENT_PAYLOAD_INVALID/);
  assert.deepEqual(sanitizePayload({ token: "secret", nested: [{ safe: true, password: "hidden" }] }), {
    token: "[redacted]",
    nested: [{ safe: true, password: "[redacted]" }],
  });
});

test("retry policy implements full jitter and Retry-After parsing", () => {
  assert.equal(fullJitterDelayMs(1, { baseDelayMs: 5000, capDelayMs: 900000, maximumAttempts: 8, random: () => 0 }), 0);
  assert.equal(fullJitterDelayMs(3, { baseDelayMs: 5000, capDelayMs: 900000, maximumAttempts: 8, random: () => 1 }), 20000);
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter("not-a-date"), null);
});

test("provider errors are classified without exposing raw credentials", () => {
  const classified = classifyProviderError(new ProviderError("HTTP token=abc123", { status: 503, code: "HTTP_503" }));
  assert.equal(classified.errorClass, "RETRYABLE");
  assert.equal(classified.code, "HTTP_503");
  assert.match(classified.summary, /token=\[redacted\]/);
  assert.equal(classifyProviderError(new ProviderError("bad token", { status: 401 })).errorClass, "CONFIGURATION");
  assert.equal(classifyProviderError(new ProviderError("invalid endpoint", { errorClass: "INVALID_ENDPOINT" })).errorClass, "INVALID_ENDPOINT");
});
