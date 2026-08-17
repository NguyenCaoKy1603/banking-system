import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import test from "node:test";

import {
  BANKING_SYSTEM_STATE_VERSION,
  BankingSystem,
  type BankingSystemState,
} from "../bankingSystem.js";
import { createPersistentBankingServer } from "../http.js";
import { PostgresSnapshotRepository } from "../postgresSnapshotRepository.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const SANDBOX_OPERATOR_KEY = "sandbox-operator-local";

function getAccountNumber(system: BankingSystem, userId: string): string {
  const account = system.listAccounts(userId)[0];
  assert.ok(account);
  return system.getAccountNumber(userId, account.id);
}

function uniquePhone(): string {
  return `09${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

test("M6 snapshot without credit fields migrates to the current state version", () => {
  const source = new BankingSystem({ sandboxOtp: "123456" });
  const user = source.register({
    fullName: "Legacy Snapshot User",
    email: `legacy-${randomUUID()}@example.com`,
    phoneNumber: `09${String(Date.now()).slice(-8)}`,
    password: "Password1",
  }).user;
  const legacy = source.exportState() as BankingSystemState & Record<string, unknown>;
  delete legacy.stateVersion;
  delete legacy.creditCards;
  delete legacy.creditAccounts;
  delete legacy.creditTransactions;
  delete legacy.creditStatements;
  delete legacy.creditQuotes;
  delete legacy.creditPayments;
  delete legacy.creditIdempotency;
  delete legacy.creditSeedPurchases;

  const restored = new BankingSystem({ sandboxOtp: "123456" });
  restored.importState(legacy as BankingSystemState);
  assert.equal(restored.exportState().stateVersion, BANKING_SYSTEM_STATE_VERSION);
  assert.deepEqual(restored.listCards(user.id), []);
});

test("legacy funding notifications migrate to a user-facing security notification", () => {
  const system = new BankingSystem();
  const state = system.exportState();
  state.notifications = [[
    "user-legacy",
    [{
      id: "notification-legacy",
      type: "SANDBOX_FUNDING",
      title: "Đã cấp tiền Sandbox",
      body: "internal funding detail",
      resourceId: "transaction-legacy",
      resourceAccountId: "account-legacy",
      read: false,
      createdAt: "2026-08-17T00:00:00.000Z",
    }],
  ]];

  system.importState({ ...state, stateVersion: 4 });

  assert.deepEqual(system.listNotifications("user-legacy"), [{
    id: "notification-legacy",
    type: "SECURITY",
    title: "Tài khoản đã được nạp tiền",
    body: "Một khoản ghi có đã được cập nhật vào tài khoản.",
    resourceId: "transaction-legacy",
    resourceAccountId: "account-legacy",
    read: false,
    createdAt: "2026-08-17T00:00:00.000Z",
  }]);
});

test("snapshot newer than the runtime is rejected explicitly", () => {
  const system = new BankingSystem();
  const state = system.exportState();
  assert.throws(
    () => system.importState({ ...state, stateVersion: BANKING_SYSTEM_STATE_VERSION + 1 }),
    /newer than supported version/,
  );
});

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
      assert.ok(account);
      restoredSystem.fundSandbox(SANDBOX_OPERATOR_KEY, `persistent-funding-${randomUUID()}`, {
        recipientAccountNumber: getAccountNumber(restoredSystem, registered.id),
        amount: { currency: "VND", amountMinor: "10000000" },
        reason: "persistent transfer fixture funding",
      });
      const recipient = restoredSystem.register({
        fullName: "Persistent Transfer Recipient",
        email: `persistent-recipient-${randomUUID()}@example.com`,
        phoneNumber: uniquePhone(),
        password: "Password1",
      }).user;
      const beneficiary = restoredSystem.createBeneficiary(registered.id, {
        displayName: "Persistent Recipient",
        accountNumber: getAccountNumber(restoredSystem, recipient.id),
        bankName: "Reference Bank",
      });
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
  assert.equal(transactionCount.transactionCount, 2);
  assert.equal(transactionCount.outboxCount, 2);
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
  assert.equal(registerResponse.status, 202);
  const registration = (await registerResponse.json()) as { challengeId: string };
  const verifyRegistrationResponse = await request(first.baseUrl, "/auth/register/verify", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: json({ challengeId: registration.challengeId, proof: "123456" }),
  });
  assert.equal(verifyRegistrationResponse.status, 201);
  const registered = (await verifyRegistrationResponse.json()) as { user: { id: string } };
  await closeServer(first.server);

  const second = await startServer(
    new BankingSystem({ sandboxOtp: "123456", mfaRequired: false }),
  );
  await repository.withState(
    new BankingSystem({ sandboxOtp: "123456" }).exportState(),
    async (state) => {
      const fixture = new BankingSystem({ sandboxOtp: "123456" });
      fixture.importState(state as BankingSystemState);
      fixture.fundSandbox(SANDBOX_OPERATOR_KEY, `persistent-http-funding-${uniqueSuffix}`, {
        recipientAccountNumber: getAccountNumber(fixture, registered.user.id),
        amount: { currency: "VND", amountMinor: "10000000" },
        reason: "persistent HTTP transfer fixture funding",
      });
      const recipient = fixture.register({
        fullName: "Persistent HTTP Recipient",
        email: `persistent-http-recipient-${uniqueSuffix}@example.com`,
        phoneNumber: uniquePhone(),
        password: "Password1",
      }).user;
      fixture.createBeneficiary(registered.user.id, {
        displayName: "Persistent HTTP Recipient",
        accountNumber: getAccountNumber(fixture, recipient.id),
        bankName: "Reference Bank",
      });
      return { result: undefined, nextState: fixture.exportState() };
    },
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
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0]?.status, "SUCCEEDED");
});

test("PostgreSQL snapshot persists a savings opening across restart", {
  skip: !databaseUrl,
}, async (t) => {
  const repository = new PostgresSnapshotRepository({
    connectionString: databaseUrl,
    snapshotKey: `savings-restart-test-${randomUUID()}`,
  });
  t.after(async () => {
    await repository.deleteSnapshot();
    await repository.close();
  });
  await repository.initialize();

  const firstSystem = new BankingSystem({ sandboxOtp: "123456" });
  const created = await repository.withState(
    firstSystem.exportState(),
    async (state) => {
      firstSystem.importState(state as BankingSystemState);
      const user = firstSystem.register({
        fullName: "Persistent Savings User",
        email: `persistent-savings-${randomUUID()}@example.com`,
        phoneNumber: `09${String(Date.now()).slice(-8)}`,
        password: "Password1",
      }).user;
      const account = firstSystem.listAccounts(user.id)[0];
      assert.ok(account);
      firstSystem.fundSandbox(SANDBOX_OPERATOR_KEY, `persistent-savings-funding-${randomUUID()}`, {
        recipientAccountNumber: getAccountNumber(firstSystem, user.id),
        amount: { currency: "VND", amountMinor: "10000000" },
        reason: "persistent savings fixture funding",
      });
      const quote = firstSystem.createSavingsQuote(user.id, {
        sourceAccountId: account.id,
        productId: "savings-vnd-1m",
        principal: { currency: "VND", amountMinor: "1000000" },
        maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
      });
      const opening = firstSystem.submitSavingsOpening(
        user.id,
        "persistent-savings-idempotency-key",
        {
          quoteId: quote.quoteId,
          stepUp: { method: "OTP", proof: "123456" },
        },
      );
      return {
        result: {
          userId: user.id,
          openingId: opening.openingId,
          depositId: opening.depositId,
        },
        nextState: firstSystem.exportState(),
      };
    },
  );

  assert.ok(created.depositId);
  const restoredSystem = new BankingSystem({ sandboxOtp: "123456" });
  const restored = await repository.withState(
    restoredSystem.exportState(),
    async (state) => {
      restoredSystem.importState(state as BankingSystemState);
      const opening = restoredSystem.getSavingsOpening(
        created.userId,
        created.openingId,
      );
      const deposits = restoredSystem.listSavingsDeposits(created.userId);
      return {
        result: {
          openingStatus: opening.status,
          deposit: deposits.items.find((item) => item.depositId === created.depositId),
          availableBalance: restoredSystem.listAccounts(created.userId)[0]?.availableBalance.amountMinor,
        },
        nextState: restoredSystem.exportState(),
      };
    },
  );

  assert.equal(restored.openingStatus, "SUCCEEDED");
  assert.equal(restored.deposit?.status, "ACTIVE");
  assert.equal(restored.availableBalance, "9000000");
});

test("PostgreSQL snapshot persists M7 credit state and serializes concurrent payment", {
  skip: !databaseUrl,
}, async (t) => {
  const repository = new PostgresSnapshotRepository({
    connectionString: databaseUrl,
    snapshotKey: `credit-restart-test-${randomUUID()}`,
  });
  t.after(async () => {
    await repository.deleteSnapshot();
    await repository.close();
  });
  await repository.initialize();

  const firstSystem = new BankingSystem({ sandboxOtp: "123456" });
  const created = await repository.withState(
    firstSystem.exportState(),
    async (state) => {
      firstSystem.importState(state as BankingSystemState);
      const user = firstSystem.register({
        fullName: "Persistent Credit User",
        email: `persistent-credit-${randomUUID()}@example.com`,
        phoneNumber: `09${String(Date.now()).slice(-8)}`,
        password: "Password1",
      }).user;
      firstSystem.seedCreditSandbox(SANDBOX_OPERATOR_KEY, user.id);
      firstSystem.fundSandbox(SANDBOX_OPERATOR_KEY, `persistent-credit-funding-${randomUUID()}`, {
        recipientAccountNumber: getAccountNumber(firstSystem, user.id),
        amount: { currency: "VND", amountMinor: "10000000" },
        reason: "persistent credit fixture funding",
      });
      const card = firstSystem.listCards(user.id)[0];
      const account = firstSystem.listCreditAccounts(user.id)[0];
      const source = firstSystem.listAccounts(user.id)[0];
      const statement = account
        ? firstSystem.listCreditStatements(user.id, account.creditAccountId).items[0]
        : undefined;
      assert.ok(card);
      assert.ok(account);
      assert.ok(source);
      assert.ok(statement);
      const quote = firstSystem.createCreditPaymentQuote(user.id, {
        sourceAccountId: source.id,
        creditAccountId: account.creditAccountId,
        statementId: statement.statementId,
        paymentOption: "CUSTOM",
        amount: { currency: "VND", amountMinor: "1000000" },
      });
      return {
        result: {
          userId: user.id,
          cardId: card.cardId,
          creditAccountId: account.creditAccountId,
          statementId: statement.statementId,
          sourceAccountId: source.id,
          quoteId: quote.quoteId,
        },
        nextState: firstSystem.exportState(),
      };
    },
  );

  const restored = await repository.withState(
    new BankingSystem({ sandboxOtp: "123456" }).exportState(),
    async (state) => {
      const system = new BankingSystem({ sandboxOtp: "123456" });
      system.importState(state as BankingSystemState);
      const card = system.getCard(created.userId, created.cardId);
      const account = system.getCreditAccount(created.userId, created.creditAccountId);
      const statement = system.getCreditStatement(
        created.userId,
        created.creditAccountId,
        created.statementId,
      );
      return {
        result: {
          cardStatus: card.card.status,
          postedOutstanding: account.postedOutstanding.amountMinor,
          statementRemaining: statement.remainingAmountDue.amountMinor,
        },
        nextState: system.exportState(),
      };
    },
  );
  assert.equal(restored.cardStatus, "ACTIVE");
  assert.equal(restored.postedOutstanding, "4000000");
  assert.equal(restored.statementRemaining, "4000000");

  const submit = (idempotencyKey: string) =>
    repository.withState(
      new BankingSystem({ sandboxOtp: "123456" }).exportState(),
      async (state) => {
        const system = new BankingSystem({ sandboxOtp: "123456" });
        system.importState(state as BankingSystemState);
        const payment = system.submitCreditPayment(created.userId, idempotencyKey, {
          quoteId: created.quoteId,
          stepUp: { method: "OTP", proof: "123456" },
        });
        return { result: payment, nextState: system.exportState() };
      },
    );

  const outcomes = await Promise.allSettled([
    submit("persistent-credit-payment-a"),
    submit("persistent-credit-payment-b"),
  ]);
  const fulfilled = outcomes.filter(
    (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof submit>>> =>
      outcome.status === "fulfilled",
  );
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const finalState = await repository.withState(
    new BankingSystem({ sandboxOtp: "123456" }).exportState(),
    async (state) => {
      const system = new BankingSystem({ sandboxOtp: "123456" });
      system.importState(state as BankingSystemState);
      const account = system.getCreditAccount(created.userId, created.creditAccountId);
      const statement = system.getCreditStatement(
        created.userId,
        created.creditAccountId,
        created.statementId,
      );
      return {
        result: {
          sourceAvailable: system.listAccounts(created.userId)[0]?.availableBalance.amountMinor,
          postedOutstanding: account.postedOutstanding.amountMinor,
          statementRemaining: statement.remainingAmountDue.amountMinor,
          paymentCount: statement.payments.length,
          reconciliation: system.reconcileCredit()[0]?.differenceMinor,
        },
        nextState: system.exportState(),
      };
    },
  );
  assert.equal(finalState.sourceAvailable, "9000000");
  assert.equal(finalState.postedOutstanding, "3000000");
  assert.equal(finalState.statementRemaining, "3000000");
  assert.equal(finalState.paymentCount, 1);
  assert.equal(finalState.reconciliation, "0");
});
