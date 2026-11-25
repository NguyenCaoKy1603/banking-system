import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import { evaluateTransferAnomaly } from "../domain/anomaly/index.js";
import { createBankingServer } from "../http.js";
import { InMemoryAdminRepository } from "../admin/repositories/adminRepository.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 0x42);

test("evaluateTransferAnomaly stays LOW for normal daytime transfer to saved recipient", () => {
  // 14:00 Vietnam time (07:00 UTC)
  const result = evaluateTransferAnomaly({
    amountMinor: 500_000n,
    feeMinor: 1_000n,
    availableBalanceMinor: 10_000_000n,
    isNewRecipient: false,
    recentTransfersLast10mCount: 0,
    sameRecipientLast15mCount: 0,
    occurredAt: "2026-11-18T07:00:00.000Z",
  });

  assert.equal(result.riskLevel, "LOW");
  assert.equal(result.riskScore, 0);
  assert.equal(result.flagged, false);
  assert.equal(result.requiresConfirmation, false);
  assert.equal(result.flags.length, 0);
});

test("evaluateTransferAnomaly detects all 6 anomaly rules and caps score at 100", () => {
  // 02:30 Vietnam time = 19:30 UTC previous day
  const result = evaluateTransferAnomaly({
    amountMinor: 4_000_000n,
    feeMinor: 1_000n,
    availableBalanceMinor: 4_500_000n,
    isNewRecipient: true,
    recentTransfersLast10mCount: 4,
    sameRecipientLast15mCount: 2,
    occurredAt: "2026-11-17T19:30:00.000Z",
  });

  const codes = result.flags.map((flag) => flag.code);
  assert.deepEqual(codes, [
    "HIGH_VALUE_TRANSFER",
    "LARGE_BALANCE_DRAIN",
    "NEW_RECIPIENT_HIGH_AMOUNT",
    "VELOCITY_SPIKE",
    "RAPID_REPEATED_RECIPIENT",
    "UNUSUAL_NIGHT_HOUR",
  ]);
  assert.equal(result.riskScore, 100);
  assert.equal(result.riskLevel, "CRITICAL");
  assert.equal(result.flagged, true);
  assert.equal(result.requiresConfirmation, true);
});

test("RelationalHttpBoundary enables /anomalies routes with transfers or accounts", () => {
  const unitOfWork = {} as ConstructorParameters<typeof RelationalHttpBoundary>[0];
  const boundary = new RelationalHttpBoundary(unitOfWork, "auth,transfers");
  assert.equal(boundary.isRouteEnabled("GET", ["anomalies"]), true);
  assert.equal(boundary.isRouteEnabled("GET", ["anomalies", "anomaly-1"]), true);
  assert.equal(boundary.isRouteEnabled("POST", ["anomalies", "anomaly-1", "acknowledge"]), true);
  assert.equal(boundary.isRouteEnabled("DELETE", ["anomalies", "anomaly-1"]), false);
});

test("HTTP transfer flow flags anomalous quote/submit and supports customer acknowledgement", async (t) => {
  const fixedNow = Date.parse("2026-11-18T08:00:00.000Z"); // 15:00 ICT
  const system = new BankingSystem({
    clock: () => fixedNow,
    sandboxOtp: "123456",
    allowUnsafeDirectSandboxStepUp: true,
  });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const deviceHeaders = { "X-Device-ID": "device-anomaly-1" };
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  // Register sender and recipient
  const begin = await request("/auth/register", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      fullName: "Anomaly Tester",
      email: "anomaly-sender@example.com",
      phoneNumber: "0900001122",
      password: "Password1",
    }),
  });
  assert.equal(begin.status, 202);
  const regChallenge = (await begin.json()) as { challengeId: string };
  const otp = system.readTestVerificationCode(regChallenge.challengeId);
  const verifyReg = await request("/auth/register/verify", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      challengeId: regChallenge.challengeId,
      method: "EMAIL_OTP",
      proof: otp,
    }),
  });
  assert.equal(verifyReg.status, 201);

  const loginRes = await request("/auth/login", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ email: "anomaly-sender@example.com", password: "Password1" }),
  });
  assert.equal(loginRes.status, 200);
  const login = (await loginRes.json()) as { accessToken: string };
  const authHeaders = { Authorization: `Bearer ${login.accessToken}`, ...deviceHeaders };

  const accountsRes = await request("/accounts", { headers: authHeaders });
  const accountsPayload = (await accountsRes.json()) as { accounts: Array<{ id: string }> };
  const sourceAccountId = accountsPayload.accounts[0]!.id;
  const numberRes = await request(`/accounts/${sourceAccountId}/number`, { headers: authHeaders });
  const { accountNumber: senderNumber } = (await numberRes.json()) as { accountNumber: string };

  // Seed 4,200,000 VND so transferring 4,000,000 to a new recipient triggers HIGH_VALUE + DRAIN + NEW_RECIPIENT
  system.seedReferenceFunding("anomaly-seed-1", {
    recipientAccountNumber: senderNumber,
    amount: { currency: "VND", amountMinor: "4200000" },
    reason: "anomaly test funding",
  });

  const recipient = system.register({
    fullName: "Anomaly Recipient",
    email: "anomaly-recipient@example.com",
    phoneNumber: "0900003344",
    password: "Password1",
  }).user;
  const recipientAccountId = system.listAccounts(recipient.id)[0]!.id;
  const recipientNumber = system.getAccountNumber(recipient.id, recipientAccountId);

  const lookupRes = await request("/internal-recipients/lookup", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ accountNumber: recipientNumber }),
  });
  assert.equal(lookupRes.status, 200);
  const { recipient: lookup } = (await lookupRes.json()) as { recipient: { lookupId: string } };

  const quoteRes = await request("/transfers/quote", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sourceAccountId,
      lookupId: lookup.lookupId,
      amount: { currency: "VND", amountMinor: "4000000" },
    }),
  });
  assert.equal(quoteRes.status, 200);
  const quote = (await quoteRes.json()) as {
    quoteId: string;
    anomalyAssessment?: {
      riskLevel: string;
      riskScore: number;
      flagged: boolean;
      requiresConfirmation: boolean;
      flags: Array<{ code: string }>;
    };
  };
  assert.ok(quote.anomalyAssessment);
  assert.equal(quote.anomalyAssessment.flagged, true);
  assert.equal(quote.anomalyAssessment.riskLevel, "CRITICAL");
  assert.equal(quote.anomalyAssessment.requiresConfirmation, true);
  assert.equal(quote.anomalyAssessment.riskScore, 95);

  const submitRes = await request("/transfers", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "anomaly-transfer-intent-1" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      confirmHighRisk: true,
      stepUp: { method: "OTP", proof: "123456" },
    }),
  });
  assert.equal(submitRes.status, 200);
  const receipt = (await submitRes.json()) as {
    transferId: string;
    anomalyAssessment?: { flagged: boolean; riskLevel: string };
  };
  assert.equal(receipt.anomalyAssessment?.flagged, true);

  const listRes = await request("/anomalies", { headers: authHeaders });
  assert.equal(listRes.status, 200);
  const listed = (await listRes.json()) as {
    items: Array<{ id: string; transferId: string; status: string; riskLevel: string }>;
  };
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.transferId, receipt.transferId);
  assert.equal(listed.items[0]?.status, "OPEN");

  const anomalyId = listed.items[0]!.id;
  const detailRes = await request(`/anomalies/${anomalyId}`, { headers: authHeaders });
  assert.equal(detailRes.status, 200);

  const ackRes = await request(`/anomalies/${anomalyId}/acknowledge`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ decision: "REPORTED_SUSPICIOUS", note: "Tôi không thực hiện giao dịch này" }),
  });
  assert.equal(ackRes.status, 200);
  const acked = (await ackRes.json()) as { anomaly: { status: string; customerNote: string | null } };
  assert.equal(acked.anomaly.status, "REPORTED_SUSPICIOUS");
  assert.equal(acked.anomaly.customerNote, "Tôi không thực hiện giao dịch này");

  const notifRes = await request("/notifications", { headers: authHeaders });
  assert.equal(notifRes.status, 200);
  const notifPayload = (await notifRes.json()) as { items: Array<{ type: string; title: string }> };
  assert.ok(notifPayload.items.some((item) => item.type === "SECURITY" && item.title.includes("bất thường")));
});

test("InMemoryAdminRepository lists and resolves transaction anomalies with audit", async () => {
  const repo = new InMemoryAdminRepository({
    anomalies: [
      {
        id: "anom-1",
        customerId: "cust-1",
        customerName: "Nguyen Van A",
        accountId: "acc-1",
        transferId: "tr-1",
        transactionId: "tx-1",
        amountMinor: "4000000",
        currency: "VND",
        counterpartyName: "Tran Van B",
        maskedDestinationAccount: "•••• 1234",
        riskLevel: "HIGH",
        riskScore: 65,
        ruleCodes: ["HIGH_VALUE_TRANSFER", "NEW_RECIPIENT_HIGH_AMOUNT"],
        summary: "Cảnh báo giao dịch bất thường mức cao",
        status: "REPORTED_SUSPICIOUS",
        customerNote: "Cần hỗ trợ kiểm tra",
        acknowledgedAt: new Date().toISOString(),
        resolutionCode: null,
        resolvedAt: null,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  await repo.initialize();

  const list = await repo.listAnomalies();
  assert.equal(list.length, 1);
  const resolved = await repo.resolveAnomaly({
    id: "anom-1",
    staffId: "staff-1",
    reasonCode: "FRAUD_VERIFIED_REVIEWED",
    comment: "Đã liên hệ khách hàng",
    traceId: "trace-anom-1",
  });
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(resolved.resolutionCode, "FRAUD_VERIFIED_REVIEWED");
  assert.equal(resolved.version, 2);

  const audits = await repo.listAudit(10);
  assert.ok(audits.some((event) => event.action === "ADMIN_ANOMALY_RESOLVED" && event.targetId === "anom-1"));
});
