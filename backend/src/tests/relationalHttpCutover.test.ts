import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createPersistentBankingServer } from "../http.js";
import type { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";

test("direct relational account route bypasses the legacy state boundary", async (t) => {
  let legacyBoundaryCalls = 0;
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy boundary must not run for direct route");
    },
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) => method === "GET" && segments.length === 1 && segments[0] === "accounts",
    authenticate: async () => ({ id: "customer-1" }),
    listAccounts: async () => [],
  } as unknown as RelationalHttpBoundary;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/accounts`, {
    headers: {
      Authorization: "Bearer direct-test-token",
      "X-Device-ID": "direct-test-device",
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accounts: [] });
  assert.equal(legacyBoundaryCalls, 0);
});

test("direct relational command routes bypass the legacy state boundary", async (t) => {
  let legacyBoundaryCalls = 0;
  const repository = {
    withState: async (): Promise<never> => {
      legacyBoundaryCalls += 1;
      throw new Error("legacy boundary must not run for direct command route");
    },
  };
  const relationalHttp = {
    isRouteEnabled: (method: string | undefined, segments: readonly string[]) =>
      method === "POST" && segments.length === 2 && segments[0] === "transfers" && segments[1] === "quote",
    authenticate: async () => ({ id: "customer-1" }),
    createTransferQuote: async () => ({
      quoteId: "quote-1",
      sourceAccountId: "account-1",
      beneficiary: { id: "beneficiary-1", displayName: "Recipient", maskedAccountNumber: "•••• 1234", bankName: "Reference", status: "ACTIVE" },
      amount: { currency: "VND", amountMinor: "100000" },
      fee: { currency: "VND", amountMinor: "1000" },
      totalDebit: { currency: "VND", amountMinor: "101000" },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  } as unknown as RelationalHttpBoundary;
  const server = createPersistentBankingServer(repository, new BankingSystem(), { relationalHttp });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/transfers/quote`, {
    method: "POST",
    headers: {
      Authorization: "Bearer direct-test-token",
      "X-Device-ID": "direct-test-device",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sourceAccountId: "account-1", beneficiaryId: "beneficiary-1", amount: { currency: "VND", amountMinor: "100000" } }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { quoteId: string }).quoteId, "quote-1");
  assert.equal(legacyBoundaryCalls, 0);
});
