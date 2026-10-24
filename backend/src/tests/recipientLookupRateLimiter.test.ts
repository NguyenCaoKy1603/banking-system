import test from "node:test";
import assert from "node:assert/strict";

import { RecipientLookupRateLimiter } from "../middlewares/index.js";
import { DomainError } from "../errors.js";

test("RecipientLookupRateLimiter allows requests within the rate limit", () => {
  let currentTime = 1_000_000;
  const limiter = new RecipientLookupRateLimiter({
    rateLimitPerMinute: 3,
    now: () => currentTime,
  });

  assert.doesNotThrow(() => limiter.acquire("user-1"));
  assert.doesNotThrow(() => limiter.acquire("user-1"));
  assert.doesNotThrow(() => limiter.acquire("user-1"));
});

test("RecipientLookupRateLimiter throws rateLimited error when exceeding rate limit", () => {
  let currentTime = 1_000_000;
  const limiter = new RecipientLookupRateLimiter({
    rateLimitPerMinute: 2,
    now: () => currentTime,
  });

  limiter.acquire("user-1");
  limiter.acquire("user-1");

  assert.throws(
    () => limiter.acquire("user-1"),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.status, 429);
      assert.equal(err.code, "RATE_LIMITED");
      assert.ok(typeof err.retryAfterSeconds === "number" && err.retryAfterSeconds > 0);
      return true;
    },
  );
});

test("RecipientLookupRateLimiter isolates rate limits per user", () => {
  let currentTime = 1_000_000;
  const limiter = new RecipientLookupRateLimiter({
    rateLimitPerMinute: 2,
    now: () => currentTime,
  });

  limiter.acquire("user-1");
  limiter.acquire("user-1");

  assert.throws(() => limiter.acquire("user-1"));
  // user-2 should still be allowed
  assert.doesNotThrow(() => limiter.acquire("user-2"));
});

test("RecipientLookupRateLimiter expires old timestamps after 60 seconds", () => {
  let currentTime = 1_000_000;
  const limiter = new RecipientLookupRateLimiter({
    rateLimitPerMinute: 2,
    now: () => currentTime,
  });

  limiter.acquire("user-1");
  limiter.acquire("user-1");
  assert.throws(() => limiter.acquire("user-1"));

  // Advance time by 61 seconds
  currentTime += 61_000;
  assert.doesNotThrow(() => limiter.acquire("user-1"));
});
