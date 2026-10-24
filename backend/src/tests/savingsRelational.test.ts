import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalSavingsService } from "../database/savingsService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });

async function fixture(database: DatabasePool): Promise<{ customerId: string; accountId: string }> {
  const customerId = randomUUID();
  const accountId = randomUUID();
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'Savings relational user', $2, $3, 'salt', 'digest', NOW())`,
    [customerId, `savings-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO payment_accounts
      (id, customer_id, display_name, masked_number, currency, available_minor,
       current_minor, status, version, updated_at, account_number, bank_name,
       opening_balance_minor, held_minor)
     VALUES ($1, $2, 'Savings source', '•••• 9001', 'VND', 10000000, 10000000,
             'ACTIVE', 0, NOW(), $3, 'Reference Bank', 0, 0)`,
    [accountId, customerId, `9704${(Number.parseInt(accountId.replaceAll("-", "").slice(0, 8), 16) % 100000000).toString().padStart(8, "0")}`],
  );
  return { customerId, accountId };
}

test("relational savings opening is atomic, idempotent and restart-readable", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 12 });
  const unitOfWork = new UnitOfWork(database);
  const savings = new RelationalSavingsService(unitOfWork);
  const fixtureIds = await fixture(database);
  t.after(() => database.close());

  const products = await savings.listProducts(fixtureIds.customerId);
  assert.equal(products.length, 4);
  const quote = await savings.createQuote(fixtureIds.customerId, {
    sourceAccountId: fixtureIds.accountId,
    productId: "savings-vnd-1m",
    principal: { currency: "VND", amountMinor: "2000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });

  const [first, second] = await Promise.all([
    savings.submitOpening({ customerId: fixtureIds.customerId, idempotencyKey: "savings-concurrent-key-1", request: { quoteId: quote.quoteId, stepUp: { method: "TOTP", proof: "not-used" } } }),
    savings.submitOpening({ customerId: fixtureIds.customerId, idempotencyKey: "savings-concurrent-key-2", request: { quoteId: quote.quoteId, stepUp: { method: "TOTP", proof: "not-used" } } }),
  ]);
  assert.equal(first.openingId, second.openingId);
  assert.equal(first.status, "SUCCEEDED");

  const account = await database.query<{ available_minor: string }>("SELECT available_minor::text FROM payment_accounts WHERE id = $1", [fixtureIds.accountId]);
  assert.equal(account.rows[0]?.available_minor, "8000000");
  const counts = await database.query<{ openings: string; deposits: string; debits: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM savings_openings WHERE customer_id = $1) AS openings,
       (SELECT COUNT(*)::text FROM savings_deposits WHERE customer_id = $1) AS deposits,
       (SELECT COUNT(*)::text FROM account_transactions WHERE account_id = $2 AND savings_opening_id IS NOT NULL) AS debits`,
    [fixtureIds.customerId, fixtureIds.accountId],
  );
  assert.deepEqual(counts.rows[0], { openings: "1", deposits: "1", debits: "1" });

  const restarted = new RelationalSavingsService(new UnitOfWork(database));
  assert.equal((await restarted.getOpening(fixtureIds.customerId, first.openingId)).depositId, first.depositId);
  assert.equal((await restarted.listDeposits(fixtureIds.customerId)).items.length, 1);
  assert.equal((await restarted.getDeposit(fixtureIds.customerId, first.depositId!)).depositId, first.depositId);

  // Test updating maturity instruction
  const updatedDeposit = await savings.updateMaturityInstruction(fixtureIds.customerId, first.depositId!, "RENEW_PRINCIPAL");
  assert.equal(updatedDeposit.maturityInstruction, "RENEW_PRINCIPAL");

  // Test early withdrawal
  const withdrawalReceipt = await savings.withdrawEarly({
    customerId: fixtureIds.customerId,
    depositId: first.depositId!,
    idempotencyKey: "wth-relational-key-1",
  });
  assert.equal(withdrawalReceipt.status, "CLOSED");
  assert.equal(withdrawalReceipt.principal.amountMinor, "2000000");
  assert.equal(withdrawalReceipt.demandRateBasisPoints, 20);
  assert.ok(BigInt(withdrawalReceipt.totalPayout.amountMinor) >= 2000000n);

  const accountAfterWithdraw = await database.query<{ available_minor: string }>("SELECT available_minor::text FROM payment_accounts WHERE id = $1", [fixtureIds.accountId]);
  assert.equal(accountAfterWithdraw.rows[0]?.available_minor, (8000000n + BigInt(withdrawalReceipt.totalPayout.amountMinor)).toString());

  const depositAfterWithdraw = await savings.getDeposit(fixtureIds.customerId, first.depositId!);
  assert.equal(depositAfterWithdraw.status, "CLOSED");
});

test("relational savings rollback leaves no opening, deposit or debit", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  const savings = new RelationalSavingsService(unitOfWork);
  const fixtureIds = await fixture(database);
  t.after(() => database.close());
  const quote = await savings.createQuote(fixtureIds.customerId, {
    sourceAccountId: fixtureIds.accountId,
    productId: "savings-vnd-3m",
    principal: { currency: "VND", amountMinor: "1500000" },
    maturityInstruction: "RENEW_PRINCIPAL",
  });
  await assert.rejects(
    savings.submitOpening({
      customerId: fixtureIds.customerId,
      idempotencyKey: "savings-rollback-key-1",
      request: { quoteId: quote.quoteId, stepUp: { method: "TOTP", proof: "not-used" } },
      fault: async (point) => { if (point === "after_ledger_written") throw new Error("savings-fault"); },
    }),
    /savings-fault/,
  );
  const state = await database.query<{ openings: string; deposits: string; available_minor: string; consumed: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM savings_openings WHERE customer_id = $1) AS openings,
       (SELECT COUNT(*)::text FROM savings_deposits WHERE customer_id = $1) AS deposits,
       (SELECT available_minor::text FROM payment_accounts WHERE id = $2) AS available_minor,
       (SELECT COUNT(*)::text FROM savings_quotes WHERE id = $3 AND consumed_at IS NOT NULL) AS consumed`,
    [fixtureIds.customerId, fixtureIds.accountId, quote.quoteId],
  );
  assert.deepEqual(state.rows[0], { openings: "0", deposits: "0", available_minor: "10000000", consumed: "0" });
});
