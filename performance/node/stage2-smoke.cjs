#!/usr/bin/env node

// Node-native performance/integrity smoke equivalent for environments without k6.
// It creates disposable sandbox users, never prints credentials or financial IDs,
// and exits non-zero when an integrity or latency threshold fails.

const assert = require("node:assert/strict");

const baseUrl = (process.env.PERF_BASE_URL ?? "http://127.0.0.1:5000/api/v1").replace(/\/+$/, "");
const rootUrl = baseUrl.endsWith("/api/v1")
  ? baseUrl.slice(0, -"/api/v1".length)
  : new URL(baseUrl).origin;
const ownerEmail = process.env.PERF_OWNER_EMAIL?.trim();
const recipientEmail = process.env.PERF_RECIPIENT_EMAIL?.trim();
const ownerTotpSecret = process.env.PERF_OWNER_TOTP_SECRET?.trim();
const recipientTotpSecret = process.env.PERF_RECIPIENT_TOTP_SECRET?.trim();
const ownerDevice = process.env.PERF_OWNER_DEVICE_ID?.trim() ?? "stage2-perf-owner";
const recipientDevice = process.env.PERF_RECIPIENT_DEVICE_ID?.trim() ?? "stage2-perf-recipient";
const readIterations = Number(process.env.PERF_READ_ITERATIONS ?? "20");
const transferConcurrency = Number(process.env.PERF_TRANSFER_CONCURRENCY ?? "20");
const password = process.env.PERF_PASSWORD ?? "Stage2PerformancePassword1";

if (!ownerEmail || !recipientEmail || !ownerTotpSecret || !recipientTotpSecret) {
  throw new Error("PERF_OWNER_EMAIL, PERF_RECIPIENT_EMAIL, PERF_OWNER_TOTP_SECRET and PERF_RECIPIENT_TOTP_SECRET are required for an existing MFA fixture.");
}
if (!Number.isInteger(readIterations) || readIterations < 1 || readIterations > 200) {
  throw new Error("PERF_READ_ITERATIONS must be an integer between 1 and 200.");
}
if (!Number.isInteger(transferConcurrency) || transferConcurrency < 2 || transferConcurrency > 100) {
  throw new Error("PERF_TRANSFER_CONCURRENCY must be an integer between 2 and 100.");
}

const nowSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return Number(sorted[index].toFixed(2));
}

function summarize(samples) {
  const durations = samples.map((sample) => sample.durationMs);
  return {
    count: samples.length,
    p50Ms: percentile(durations, 0.5),
    p90Ms: percentile(durations, 0.9),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: Number(Math.max(...durations, 0).toFixed(2)),
    failures: samples.filter((sample) => !sample.ok).length,
  };
}

async function request(path, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return {
    response,
    body,
    durationMs: performance.now() - startedAt,
  };
}

async function requestRoot(path, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${rootUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return {
    response,
    body,
    durationMs: performance.now() - startedAt,
  };
}

async function expectStatus(path, init, expectedStatus) {
  const result = await request(path, init);
  assert.equal(result.response.status, expectedStatus, `Unexpected HTTP status for ${path}`);
  return result.body;
}

const totpState = new Map();
async function totpCode(secret) {
  const { Secret, TOTP } = require("otpauth");
  let now = Date.now();
  let step = Math.floor(now / 30000);
  const lastStep = totpState.get(secret) ?? -1;
  if (step <= lastStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastStep + 1) * 30000) - now + 250));
    now = Date.now();
    step = Math.floor(now / 30000);
  }
  totpState.set(secret, step);
  const totp = new TOTP({ issuer: "Banking Reference", label: "stage2-perf", algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
  return totp.generate({ timestamp: now });
}

async function login(email, deviceId, secret) {
  const first = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ email, password }),
  });
  if (first.response.status === 202) {
    const otp = await totpCode(secret);
    return expectStatus("/auth/verify", {
      method: "POST",
      headers: { "X-Device-ID": deviceId },
      body: JSON.stringify({
        challengeId: first.body.challengeId,
        method: "TOTP",
        proof: otp,
      }),
    }, 200);
  }
  assert.equal(first.response.status, 200, "Login must return 200 or an MFA challenge.");
  return first.body;
}

function authHeaders(session, deviceId) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Device-ID": deviceId,
  };
}

async function main() {
  const healthSamples = [];
  const readSamples = [];
  const quoteSamples = [];
  const ownerSession = await login(ownerEmail, ownerDevice, ownerTotpSecret);
  const recipientSession = await login(recipientEmail, recipientDevice, recipientTotpSecret);
  const ownerHeaders = authHeaders(ownerSession, ownerDevice);
  const recipientHeaders = authHeaders(recipientSession, recipientDevice);

  const ownerAccounts = await expectStatus("/accounts", { headers: ownerHeaders }, 200);
  const recipientAccounts = await expectStatus("/accounts", { headers: recipientHeaders }, 200);
  const ownerAccountId = ownerAccounts.accounts[0]?.id;
  const recipientAccountId = recipientAccounts.accounts[0]?.id;
  assert.ok(ownerAccountId && recipientAccountId);
  const ownerAccount = ownerAccounts.accounts[0];
  assert.ok(ownerAccount);
  const availableMinor = BigInt(ownerAccount.availableBalance?.amountMinor ?? "0");
  if (availableMinor < 100_000n) {
    throw new Error("PERF owner fixture must be pre-funded; use the Admin four-eyes funding workflow before running this smoke.");
  }

  const recipientNumber = await expectStatus(`/accounts/${recipientAccountId}/number`, {
    headers: recipientHeaders,
  }, 200);
  const beneficiary = await expectStatus("/beneficiaries", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({
      displayName: "Stage 2 Performance Recipient",
      accountNumber: recipientNumber.accountNumber,
      bankName: "Reference Bank",
    }),
  }, 201);
  const beneficiaryId = beneficiary.beneficiary?.id;
  assert.ok(beneficiaryId);

  for (let index = 0; index < readIterations; index += 1) {
    const health = await requestRoot("/healthz");
    healthSamples.push({ durationMs: health.durationMs, ok: health.response.status === 200 });
    const accounts = await request("/accounts", { headers: ownerHeaders });
    readSamples.push({ durationMs: accounts.durationMs, ok: accounts.response.status === 200 });
    const history = await request(`/accounts/${ownerAccountId}/transactions`, { headers: ownerHeaders });
    readSamples.push({ durationMs: history.durationMs, ok: history.response.status === 200 });
    const notifications = await request("/notifications", { headers: ownerHeaders });
    readSamples.push({ durationMs: notifications.durationMs, ok: notifications.response.status === 200 });
  }

  let quote;
  for (let index = 0; index < readIterations; index += 1) {
    const quoteResult = await request("/transfers/quote", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        sourceAccountId: ownerAccountId,
        beneficiaryId,
        amount: { currency: "VND", amountMinor: "100000" },
      }),
    });
    quoteSamples.push({ durationMs: quoteResult.durationMs, ok: quoteResult.response.status === 200 });
    assert.equal(quoteResult.response.status, 200, "quote creation must return 200");
    quote ??= quoteResult.body;
  }
  const challenge = await expectStatus("/auth/otp/challenges", {
    method: "POST",
    headers: ownerHeaders,
    body: JSON.stringify({ purpose: "TRANSFER", resourceId: quote.quoteId }),
  }, 201);
  const transferOtp = await totpCode(ownerTotpSecret);
  const transferHeaders = {
    ...ownerHeaders,
    "Idempotency-Key": `stage2-perf-transfer-${nowSuffix}`,
  };
  const transferPayload = JSON.stringify({
    quoteId: quote.quoteId,
    stepUp: { method: "TOTP", proof: transferOtp, challengeId: challenge.challengeId },
  });
  const transferSamples = await Promise.all(
    Array.from({ length: transferConcurrency }, () => request("/transfers", {
      method: "POST",
      headers: transferHeaders,
      body: transferPayload,
    })),
  );
  const transferIds = new Set(transferSamples.map((sample) => sample.body?.transferId).filter(Boolean));
  assert.equal(transferIds.size, 1, "concurrent replay must produce one canonical transfer");
  assert.equal(transferSamples.filter((sample) => sample.response.status === 200).length, 1, "only one request may consume a TOTP challenge");
  assert.ok(transferSamples.every((sample) => sample.response.status === 200 || sample.response.status === 409), "replayed requests must be rejected as step-up conflicts");

  const finalHealthResult = await requestRoot("/healthz");
  assert.equal(finalHealthResult.response.status, 200);
  const finalHealth = finalHealthResult.body;
  assert.equal(finalHealth.status, "ok");
  assert.equal(finalHealth.reconciliation, "ok");

  const result = {
    status: "passed",
    environment: "local-compose",
    iterations: readIterations,
    transferConcurrency,
    thresholds: {
      healthP95Ms: 100,
      readP95Ms: 300,
      quoteP95Ms: 300,
      transferP95Ms: 700,
      errorRate: 0,
      doubleDebit: 0,
    },
    metrics: {
      health: summarize(healthSamples),
      read: summarize(readSamples),
      quote: summarize(quoteSamples),
      transfer: summarize(transferSamples.map((sample) => ({
        durationMs: sample.durationMs,
        ok: sample.response.status === 200,
      }))),
    },
    integrity: {
      canonicalTransferCount: transferIds.size,
      finalHealth: finalHealth.status,
      reconciliation: finalHealth.reconciliation,
    },
  };
  const thresholdFailures = [];
  if (result.metrics.health.p95Ms >= result.thresholds.healthP95Ms) thresholdFailures.push("health p95");
  if (result.metrics.read.p95Ms >= result.thresholds.readP95Ms) thresholdFailures.push("read p95");
  if (result.metrics.quote.p95Ms >= result.thresholds.quoteP95Ms) thresholdFailures.push("quote p95");
  if (result.metrics.transfer.p95Ms >= result.thresholds.transferP95Ms) thresholdFailures.push("transfer p95");
  if (result.metrics.health.failures + result.metrics.read.failures + result.metrics.transfer.failures > 0) {
    thresholdFailures.push("unexpected HTTP failure");
  }
  result.status = thresholdFailures.length === 0 ? "passed" : "threshold_failed";
  result.thresholdFailures = thresholdFailures;
  console.log(JSON.stringify(result));
  if (thresholdFailures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "performance smoke failed");
  process.exitCode = 1;
});
