import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem, type BankingSystemState } from "../bankingSystem.js";
import { conflict } from "../errors.js";
import { createPersistentBankingServer } from "../http.js";
import type { RelationalStateOperation } from "../postgresRelationalRepository.js";

const SANDBOX_OPERATOR_KEY = "sandbox-operator-local";

class MemoryStateRepository {
  private state: unknown;

  async withState<T>(
    initialState: unknown,
    operation: RelationalStateOperation<T>,
  ): Promise<T> {
    const current = structuredClone(this.state ?? initialState);
    const { result, nextState } = await operation(current);
    this.state = structuredClone(nextState);
    return result;
  }

  snapshot(): BankingSystemState {
    return structuredClone(this.state) as BankingSystemState;
  }
}

class RejectingFundingSystem extends BankingSystem {
  override fundSandbox(
    ...args: Parameters<BankingSystem["fundSandbox"]>
  ): ReturnType<BankingSystem["fundSandbox"]> {
    super.fundSandbox(...args);
    throw conflict("Forced rejection after a business mutation.");
  }
}

async function startServer(
  repository: MemoryStateRepository,
  system: BankingSystem,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createPersistentBankingServer(repository, system);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(baseUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function createRegisteredSystem(options: ConstructorParameters<typeof BankingSystem>[0] = {}): {
  system: BankingSystem;
  email: string;
} {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const email = `persistent-security-${suffix}@example.com`;
  const system = new BankingSystem(options);
  system.register({
    fullName: "Persistent Security User",
    email,
    phoneNumber: `09${suffix}`,
    password: "Password1",
  });
  return { system, email };
}

test("persistent HTTP commits refresh-family revocation after a rejected reuse request", async (t) => {
  const repository = new MemoryStateRepository();
  const deviceId = `refresh-device-${randomUUID()}`;
  const { system, email } = createRegisteredSystem({ mfaRequired: false });
  const runningServers: Server[] = [];
  t.after(async () => {
    for (const server of runningServers) {
      await closeServer(server);
    }
  });

  const first = await startServer(repository, system);
  runningServers.push(first.server);
  const loginResponse = await request(first.baseUrl, "/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ email, password: "Password1" }),
  });
  assert.equal(loginResponse.status, 200);
  const initialTokens = (await loginResponse.json()) as {
    refreshToken: string;
  };

  const rotateResponse = await request(first.baseUrl, "/auth/refresh", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ refreshToken: initialTokens.refreshToken }),
  });
  assert.equal(rotateResponse.status, 200);
  const rotatedTokens = (await rotateResponse.json()) as {
    refreshToken: string;
  };

  const reuseResponse = await request(first.baseUrl, "/auth/refresh", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ refreshToken: initialTokens.refreshToken }),
  });
  assert.equal(reuseResponse.status, 401);
  await closeServer(first.server);

  const second = await startServer(
    repository,
    new BankingSystem({ mfaRequired: false }),
  );
  runningServers.push(second.server);
  const revokedFamilyResponse = await request(second.baseUrl, "/auth/refresh", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ refreshToken: rotatedTokens.refreshToken }),
  });
  assert.equal(revokedFamilyResponse.status, 401);
});

test("persistent HTTP keeps failed-login rate limits across a restart", async (t) => {
  const repository = new MemoryStateRepository();
  const { system, email } = createRegisteredSystem({ mfaRequired: false });
  const runningServers: Server[] = [];
  t.after(async () => {
    for (const server of runningServers) {
      await closeServer(server);
    }
  });

  const first = await startServer(repository, system);
  runningServers.push(first.server);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request(first.baseUrl, "/auth/login", {
      method: "POST",
      headers: { "X-Device-ID": `failed-login-device-${attempt}` },
      body: JSON.stringify({ email, password: "wrong-password" }),
    });
    assert.equal(response.status, 401);
  }
  await closeServer(first.server);

  const second = await startServer(
    repository,
    new BankingSystem({ mfaRequired: false }),
  );
  runningServers.push(second.server);
  const blockedResponse = await request(second.baseUrl, "/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": "new-device-after-restart" },
    body: JSON.stringify({ email, password: "Password1" }),
  });
  assert.equal(blockedResponse.status, 429);
});

test("persistent HTTP keeps challenge attempts and lockout across a restart", async (t) => {
  const repository = new MemoryStateRepository();
  const deviceId = `challenge-device-${randomUUID()}`;
  const options = {
    mfaRequired: true,
    sandboxMfaOtp: "654321",
  };
  const { system, email } = createRegisteredSystem(options);
  const runningServers: Server[] = [];
  t.after(async () => {
    for (const server of runningServers) {
      await closeServer(server);
    }
  });

  const first = await startServer(repository, system);
  runningServers.push(first.server);
  const loginResponse = await request(first.baseUrl, "/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ email, password: "Password1" }),
  });
  assert.equal(loginResponse.status, 202);
  const challenge = (await loginResponse.json()) as { challengeId: string };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request(first.baseUrl, "/auth/verify", {
      method: "POST",
      headers: { "X-Device-ID": deviceId },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        method: "OTP",
        proof: "000000",
      }),
    });
    assert.equal(response.status, 401);
  }
  await closeServer(first.server);

  const second = await startServer(repository, new BankingSystem(options));
  runningServers.push(second.server);
  const lockResponse = await request(second.baseUrl, "/auth/verify", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      method: "OTP",
      proof: "000000",
    }),
  });
  assert.equal(lockResponse.status, 429);

  const replayResponse = await request(second.baseUrl, "/auth/verify", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      method: "OTP",
      proof: "654321",
    }),
  });
  assert.equal(replayResponse.status, 401);
});

test("persistent HTTP keeps whitelisted step-up failure audits", async (t) => {
  const repository = new MemoryStateRepository();
  const deviceId = `audit-device-${randomUUID()}`;
  const { system, email } = createRegisteredSystem({
    mfaRequired: false,
    sandboxOtp: "123456",
  });
  const user = system.login(email, "Password1", deviceId);
  assert.ok("user" in user);
  const account = system.listAccounts(user.user.id)[0];
  assert.ok(account);
  const quote = system.createSavingsQuote(user.user.id, {
    sourceAccountId: account.id,
    productId: "savings-vnd-1m",
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  const running = await startServer(repository, system);
  t.after(() => closeServer(running.server));

  const loginResponse = await request(running.baseUrl, "/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ email, password: "Password1" }),
  });
  assert.equal(loginResponse.status, 200);
  const session = (await loginResponse.json()) as { accessToken: string };
  const authHeaders = {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Device-ID": deviceId,
  };
  const challengeResponse = await request(
    running.baseUrl,
    "/auth/otp/challenges",
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        purpose: "SAVINGS_OPENING",
        resourceId: quote.quoteId,
      }),
    },
  );
  assert.equal(challengeResponse.status, 201);
  const challenge = (await challengeResponse.json()) as { challengeId: string };
  const rejected = await request(running.baseUrl, "/savings/deposits", {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": "audit-failure-key-1" },
    body: JSON.stringify({
      quoteId: quote.quoteId,
      stepUp: {
        challengeId: challenge.challengeId,
        method: "OTP",
        proof: "000000",
      },
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal(
    ((await rejected.json()) as { code: string }).code,
    "STEP_UP_VERIFICATION_FAILED",
  );

  const persisted = repository.snapshot();
  assert.equal(
    persisted.auditEventStore.filter(
      (event) => event.eventType === "STEP_UP_VERIFICATION_FAILED",
    ).length,
    1,
  );
  assert.equal((persisted.savingsOpenings ?? []).length, 0);
});

test("persistent HTTP rolls business mutations back when a domain request is rejected", async (t) => {
  const repository = new MemoryStateRepository();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const email = `business-rollback-${suffix}@example.com`;
  const deviceId = `business-rollback-device-${suffix}`;
  const system = new RejectingFundingSystem({
    mfaRequired: false,
    sandboxOperatorKey: SANDBOX_OPERATOR_KEY,
  });
  const user = system.register({
    fullName: "Business Rollback User",
    email,
    phoneNumber: `08${suffix}`,
    password: "Password1",
  }).user;
  const account = system.listAccounts(user.id)[0];
  assert.ok(account);
  const accountNumber = system.getAccountNumber(user.id, account.id);
  const runningServers: Server[] = [];
  t.after(async () => {
    for (const server of runningServers) {
      await closeServer(server);
    }
  });

  const first = await startServer(repository, system);
  runningServers.push(first.server);
  const rejectedFunding = await request(first.baseUrl, "/sandbox/fundings", {
    method: "POST",
    headers: {
      "Idempotency-Key": `rejected-funding-${suffix}`,
      "X-Sandbox-Operator-Key": SANDBOX_OPERATOR_KEY,
    },
    body: JSON.stringify({
      recipientAccountNumber: accountNumber,
      amount: { currency: "VND", amountMinor: "1000000" },
      reason: "forced rollback regression",
    }),
  });
  assert.equal(rejectedFunding.status, 409);
  assert.equal(
    repository
      .snapshot()
      .auditEventStore.some(
        (event) => event.eventType === "SANDBOX_FUNDING_SUCCEEDED",
      ),
    false,
  );
  await closeServer(first.server);

  const second = await startServer(
    repository,
    new BankingSystem({
      mfaRequired: false,
      sandboxOperatorKey: SANDBOX_OPERATOR_KEY,
    }),
  );
  runningServers.push(second.server);
  const loginResponse = await request(second.baseUrl, "/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": deviceId },
    body: JSON.stringify({ email, password: "Password1" }),
  });
  assert.equal(loginResponse.status, 200);
  const session = (await loginResponse.json()) as { accessToken: string };
  const authHeaders = {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Device-ID": deviceId,
  };
  const accountsResponse = await request(second.baseUrl, "/accounts", {
    headers: authHeaders,
  });
  assert.equal(accountsResponse.status, 200);
  const accounts = (await accountsResponse.json()) as {
    accounts: Array<{
      id: string;
      currentBalance: { amountMinor: string };
      availableBalance: { amountMinor: string };
    }>;
  };
  assert.equal(accounts.accounts[0]?.currentBalance.amountMinor, "0");
  assert.equal(accounts.accounts[0]?.availableBalance.amountMinor, "0");

  const historyResponse = await request(
    second.baseUrl,
    `/accounts/${account.id}/transactions`,
    { headers: authHeaders },
  );
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as { items: unknown[] };
  assert.deepEqual(history.items, []);
});
