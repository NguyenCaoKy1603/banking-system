import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test from "node:test";

import {
  BankingSystem,
  type BankingSystemState,
} from "../bankingSystem.js";
import { createPersistentBankingServer } from "../http.js";
import { PostgresSnapshotRepository } from "../postgresSnapshotRepository.js";

const databaseUrl = process.env.DATABASE_URL?.trim();

test("PostgreSQL snapshot persists users and serializes concurrent transfer submit", {
  skip: !databaseUrl,
}, async (t) => {
  const repository = new PostgresSnapshotRepository({
    connectionString: databaseUrl,
    snapshotKey: `test-${randomUUID()}`,
  });
  t.after(async () => {
    await repository.deleteSnapshot();
    await repository.close();
  });
  await repository.initialize();

  const firstSystem = new BankingSystem({ sandboxOtp: "123456" });
  const registered = await repository.withState(
    firstSystem.exportState(),
    async (state) => {
      firstSystem.importState(state as BankingSystemState);
      const result = firstSystem.register({
        fullName: "Persistent User",
        email: `persistent-${randomUUID()}@example.com`,
        phoneNumber: `09${String(Date.now()).slice(-8)}`,
        password: "Password1",
      });
      return { result: result.user, nextState: firstSystem.exportState() };
    },
  );

  const restoredSystem = new BankingSystem({ sandboxOtp: "123456" });
  const restoredAccount = await repository.withState(
    restoredSystem.exportState(),
    async (state) => {
      restoredSystem.importState(state as BankingSystemState);
      const account = restoredSystem.listAccounts(registered.id)[0];
      assert.ok(account);
      return { result: account, nextState: restoredSystem.exportState() };
    },
  );
  assert.match(restoredAccount.id, /^[0-9a-f-]{36}$/i);

  const setup = await repository.withState(
    restoredSystem.exportState(),
    async (state) => {
      restoredSystem.importState(state as BankingSystemState);
      const account = restoredSystem.listAccounts(registered.id)[0];
      const beneficiary = restoredSystem.listBeneficiaries(registered.id)[0];
      assert.ok(account);
      assert.ok(beneficiary);
      const quote = restoredSystem.createQuote(registered.id, {
        sourceAccountId: account.id,
        beneficiaryId: beneficiary.id,
        amount: { currency: "VND", amountMinor: "100000" },
      });
      return {
        result: { accountId: account.id, quoteId: quote.quoteId },
        nextState: restoredSystem.exportState(),
      };
    },
  );

  const submit = async (idempotencyKey: string) => {
    const system = new BankingSystem({ sandboxOtp: "123456" });
    return repository.withState(system.exportState(), async (state) => {
      system.importState(state as BankingSystemState);
      const receipt = system.submitTransfer(registered.id, idempotencyKey, {
        quoteId: setup.quoteId,
        stepUp: { method: "OTP", proof: "123456" },
      });
      return { result: receipt, nextState: system.exportState() };
    });
  };

  const outcomes = await Promise.allSettled([
    submit("persistent-idempotency-a"),
    submit("persistent-idempotency-b"),
  ]);
  const fulfilled = outcomes.filter(
    (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof submit>>> =>
      outcome.status === "fulfilled",
  );
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0]?.reason?.message), /already been submitted/);

  const finalSystem = new BankingSystem({ sandboxOtp: "123456" });
  const transactionCount = await repository.withState(
    finalSystem.exportState(),
    async (state) => {
      finalSystem.importState(state as BankingSystemState);
      return {
        result: {
          transactionCount: finalSystem.listTransactions(registered.id, setup.accountId).items.length,
          outboxCount: finalSystem.outboxEvents.filter((event) => !event.published).length,
          reconciliation: finalSystem.reconcile()[0]?.differenceMinor,
        },
        nextState: finalSystem.exportState(),
      };
    },
  );
  assert.equal(transactionCount.transactionCount, 1);
  assert.equal(transactionCount.outboxCount, 1);
  assert.equal(transactionCount.reconciliation, "0");
});

test("PostgreSQL persistent HTTP server restores state across restart", {
  skip: !databaseUrl,
}, async (t) => {
  const repository = new PostgresSnapshotRepository({
    connectionString: databaseUrl,
    snapshotKey: `http-test-${randomUUID()}`,
  });
  await repository.initialize();

  const runningServers: Server[] = [];
  const closeServer = async (server: Server): Promise<void> => {
    if (!server.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };
  const startServer = async (system: BankingSystem): Promise<{
    server: Server;
    baseUrl: string;
  }> => {
    const server = createPersistentBankingServer(repository, system);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    runningServers.push(server);
    const address = server.address() as AddressInfo;
    return {
      server,
      baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    };
  };

  t.after(async () => {
    for (const server of runningServers) {
      await closeServer(server);
    }
    await repository.deleteSnapshot();
    await repository.close();
  });

  const uniqueSuffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const deviceId = `persistent-http-device-${uniqueSuffix}`;
  const first = await startServer(
    new BankingSystem({ sandboxOtp: "123456", mfaRequired: false }),
  );
  const request = (baseUrl: string, path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  const json = (value: unknown) => JSON.stringify(value);

  const registerResponse = await request(first.baseUrl, "/auth/register", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      fullName: "Persistent HTTP User",
      email: `persistent-http-${uniqueSuffix}@example.com`,
      phoneNumber: `09${uniqueSuffix}`,
      password: "Password1",
    }),
  });
  assert.equal(registerResponse.status, 201);
  await closeServer(first.server);

  const second = await startServer(
    new BankingSystem({ sandboxOtp: "123456", mfaRequired: false }),
  );
  const loginResponse = await request(second.baseUrl, "/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({
      email: `persistent-http-${uniqueSuffix}@example.com`,
      password: "Password1",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const login = (await loginResponse.json()) as { accessToken: string };
  const authHeaders = {
    Authorization: `Bearer ${login.accessToken}`,
    "X-Device-ID": deviceId,
  };

  const accountsResponse = await request(second.baseUrl, "/accounts", {
    headers: authHeaders,
  });
  assert.equal(accountsResponse.status, 200);
  const accounts = (await accountsResponse.json()) as {
    accounts: Array<{ id: string }>;
  };
  const beneficiariesResponse = await request(second.baseUrl, "/beneficiaries", {
    headers: authHeaders,
  });
  assert.equal(beneficiariesResponse.status, 200);
  const beneficiaries = (await beneficiariesResponse.json()) as {
    items: Array<{ id: string }>;
  };
  const accountId = accounts.accounts[0]?.id;
  const beneficiaryId = beneficiaries.items[0]?.id;
  assert.ok(accountId);
  assert.ok(beneficiaryId);

  const quoteResponse = await request(second.baseUrl, "/transfers/quote", {
    method: "POST",
    headers: authHeaders,
    body: json({
      sourceAccountId: accountId,
      beneficiaryId,
      amount: { currency: "VND", amountMinor: "100000" },
    }),
  });
  assert.equal(quoteResponse.status, 200);
  const quote = (await quoteResponse.json()) as { quoteId: string };

  const submit = (idempotencyKey: string) =>
    request(second.baseUrl, "/transfers", {
      method: "POST",
      headers: { ...authHeaders, "Idempotency-Key": idempotencyKey },
      body: json({
        quoteId: quote.quoteId,
        stepUp: { method: "OTP", proof: "123456" },
      }),
    });
  const [submitA, submitB] = await Promise.all([
    submit("persistent-http-submit-a"),
    submit("persistent-http-submit-b"),
  ]);
  assert.deepEqual(
    [submitA.status, submitB.status].sort((a, b) => a - b),
    [200, 409],
  );
  await closeServer(second.server);

  const third = await startServer(
    new BankingSystem({ sandboxOtp: "123456", mfaRequired: false }),
  );
  const historyResponse = await request(
    third.baseUrl,
    `/accounts/${accountId}/transactions`,
    { headers: authHeaders },
  );
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as {
    items: Array<{ status: string }>;
  };
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0]?.status, "SUCCEEDED");
});
