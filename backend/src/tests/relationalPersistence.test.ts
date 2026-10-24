import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { BankingSystem, type BankingSystemState } from "../bankingSystem.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { PostgresRelationalRepository } from "../database/postgresRelationalRepository.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();

if (databaseUrl) {
  assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });
}

function uniquePhone(): string {
  return `09${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function accountNumber(system: BankingSystem, userId: string): string {
  const account = system.listAccounts(userId)[0];
  assert.ok(account);
  return system.getAccountNumber(userId, account.id);
}

test("relational adapter persists restart state, serializes one quote submission and rehearses logical restore", {
  skip: !databaseUrl,
}, async (t) => {
  const repository = new PostgresRelationalRepository({
    connectionString: databaseUrl,
  });
  await repository.initialize();
  await repository.clear();
  t.after(async () => {
    await repository.clear();
    await repository.close();
  });

  const first = new BankingSystem({
    sandboxOtp: "123456",
    settleTransfersImmediately: false,
    mfaRequired: false,
  });
  const fixture = await repository.withState(
    first.exportState(),
    async (state) => {
      first.importState(state as BankingSystemState);
      const sender = first.register({
        fullName: "Relational Sender",
        email: `relational-sender-${randomUUID()}@example.com`,
        phoneNumber: uniquePhone(),
        password: "Password1",
      }).user;
      const recipient = first.register({
        fullName: "Relational Recipient",
        email: `relational-recipient-${randomUUID()}@example.com`,
        phoneNumber: uniquePhone(),
        password: "Password1",
      }).user;
      const source = first.listAccounts(sender.id)[0];
      assert.ok(source);
      first.seedReferenceFunding(`relational-funding-${randomUUID()}`, {
        recipientAccountNumber: accountNumber(first, sender.id),
        amount: { currency: "VND", amountMinor: "10000000" },
        reason: "relational persistence fixture",
      });
      const beneficiary = first.createBeneficiary(sender.id, {
        displayName: "Relational Recipient",
        accountNumber: accountNumber(first, recipient.id),
        bankName: "Reference Bank",
      });
      const quote = first.createQuote(sender.id, {
        sourceAccountId: source.id,
        beneficiaryId: beneficiary.id,
        amount: { currency: "VND", amountMinor: "100000" },
      });
      return {
        result: { senderId: sender.id, accountId: source.id, quoteId: quote.quoteId },
        nextState: first.exportState(),
      };
    },
  );

  const submit = (idempotencyKey: string) =>
    repository.withState(
      new BankingSystem({ sandboxOtp: "123456", settleTransfersImmediately: false }).exportState(),
      async (state) => {
        const system = new BankingSystem({
          sandboxOtp: "123456",
          settleTransfersImmediately: false,
          allowUnsafeDirectSandboxStepUp: true,
        });
        system.importState(state as BankingSystemState);
        const receipt = system.submitTransfer(fixture.senderId, idempotencyKey, {
          quoteId: fixture.quoteId,
          stepUp: { method: "OTP", proof: "123456" },
        });
        return { result: receipt, nextState: system.exportState() };
      },
    );

  const outcomes = await Promise.allSettled([
    submit("relational-submit-a"),
    submit("relational-submit-b"),
  ]);
  const fulfilled = outcomes.filter(
    (item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof submit>>> =>
      item.status === "fulfilled",
  );
  assert.equal(fulfilled.length, 2);
  assert.equal(fulfilled[0]?.value.transferId, fulfilled[1]?.value.transferId);

  const restored = new BankingSystem({
    sandboxOtp: "123456",
    settleTransfersImmediately: false,
  });
  const beforeSettlement = await repository.withState(
    restored.exportState(),
    async (state) => {
      restored.importState(state as BankingSystemState);
      const account = restored.listAccounts(fixture.senderId)[0];
      assert.ok(account);
      return {
        result: {
          available: account.availableBalance.amountMinor,
          held: account.heldAmount.amountMinor,
          historyCount: restored.listTransactions(fixture.senderId, fixture.accountId).items.length,
        },
        nextState: restored.exportState(),
      };
    },
  );
  assert.equal(beforeSettlement.available, "9899000");
  assert.equal(beforeSettlement.held, "101000");
  assert.equal(beforeSettlement.historyCount, 2);

  const settled = await repository.withState(
    restored.exportState(),
    async (state) => {
      restored.importState(state as BankingSystemState);
      const transferId = (state as BankingSystemState).transfers[0]?.[0];
      assert.ok(transferId);
      const receipt = restored.settleTransfer(fixture.senderId, transferId);
      return { result: receipt, nextState: restored.exportState() };
    },
  );
  assert.equal(settled.status, "SUCCEEDED");

  const finalSystem = new BankingSystem({ sandboxOtp: "123456" });
  const final = await repository.withState(
    finalSystem.exportState(),
    async (state) => {
      finalSystem.importState(state as BankingSystemState);
      const account = finalSystem.listAccounts(fixture.senderId)[0];
      assert.ok(account);
      return {
        result: {
          available: account.availableBalance.amountMinor,
          held: account.heldAmount.amountMinor,
          reconciliation: finalSystem.reconcile()[0]?.differenceMinor,
        },
        nextState: finalSystem.exportState(),
      };
    },
  );
  assert.equal(final.available, "9899000");
  assert.equal(final.held, "0");
  assert.equal(final.reconciliation, "0");

  const backupState = finalSystem.exportState();
  await repository.clear();
  const restoreSystem = new BankingSystem({ sandboxOtp: "123456" });
  const restoredFromBackup = await repository.withState(
    restoreSystem.exportState(),
    async () => {
      restoreSystem.importState(backupState);
      const account = restoreSystem.listAccounts(fixture.senderId)[0];
      assert.ok(account);
      return {
        result: {
          available: account.availableBalance.amountMinor,
          held: account.heldAmount.amountMinor,
          reconciliation: restoreSystem.reconcile()[0]?.differenceMinor,
        },
        nextState: restoreSystem.exportState(),
      };
    },
  );
  assert.deepEqual(restoredFromBackup, final);

  const afterRestoreSystem = new BankingSystem({ sandboxOtp: "123456" });
  const afterRestore = await repository.withState(
    afterRestoreSystem.exportState(),
    async (state) => {
      afterRestoreSystem.importState(state as BankingSystemState);
      const account = afterRestoreSystem.listAccounts(fixture.senderId)[0];
      assert.ok(account);
      return {
        result: {
          available: account.availableBalance.amountMinor,
          held: account.heldAmount.amountMinor,
          reconciliation: afterRestoreSystem.reconcile()[0]?.differenceMinor,
        },
        nextState: state,
      };
    },
  );
  assert.deepEqual(afterRestore, final);
});
