import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { RelationalSavingsService } from "../database/savingsService.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";
import { WorkerMetrics } from "../observability/metrics.js";
import { RelationalLifecycleScheduler, scheduledLifecycleConfigFromEnv } from "../workers/lifecycleScheduler.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });

function accountNumber(id: string): string {
  return `9704${Number.parseInt(id.replaceAll("-", "").slice(0, 8), 16) % 100000000}`.padStart(12, "0");
}

async function fixture(database: DatabasePool): Promise<{ customerId: string; accountId: string }> {
  const customerId = randomUUID();
  const accountId = randomUUID();
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'Scheduler Test', $2, $3, 'salt', 'digest', NOW())`,
    [customerId, `${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO payment_accounts
      (id, customer_id, display_name, masked_number, currency, available_minor, current_minor,
       status, version, updated_at, account_number, bank_name, opening_balance_minor, held_minor)
     VALUES ($1, $2, 'Scheduler source', $3, 'VND', 10000000, 10000000, 'ACTIVE', 0, NOW(), $4,
             'Reference Bank', 0, 0)`,
    [accountId, customerId, `•••• ${accountId.slice(-4)}`, accountNumber(accountId)],
  );
  return { customerId, accountId };
}

test("scheduled lifecycle config has safe defaults and explicit enablement", () => {
  const config = scheduledLifecycleConfigFromEnv({
    SCHEDULED_LIFECYCLE_ENABLED: "1",
    SCHEDULED_LIFECYCLE_POLL_INTERVAL_MS: "1200",
    SCHEDULED_LIFECYCLE_BATCH_SIZE: "7",
  });
  assert.deepEqual(config, { enabled: true, pollIntervalMs: 1200, batchSize: 7, stallThresholdMs: 60000 });
  assert.equal(scheduledLifecycleConfigFromEnv({}).enabled, false);
});
test("two lifecycle schedulers claim a due savings maturity once and expose successful readiness", { skip: !databaseUrl }, async (t) => {
  const firstDatabase = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const secondDatabase = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const savings = new RelationalSavingsService(new UnitOfWork(firstDatabase));
  const item = await fixture(firstDatabase);
  const quote = await savings.createQuote(item.customerId, {
    sourceAccountId: item.accountId,
    productId: "savings-vnd-1m",
    principal: { currency: "VND", amountMinor: "1000000" },
    maturityInstruction: "RETURN_PRINCIPAL_AND_INTEREST",
  });
  const opening = await savings.submitOpening({
    customerId: item.customerId,
    idempotencyKey: `scheduler-${randomUUID()}`,
    request: { quoteId: quote.quoteId, stepUp: { method: "TOTP", proof: "not-used" } },
  });
  await firstDatabase.query("UPDATE savings_deposits SET maturity_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [opening.depositId]);
  const config = { enabled: true, pollIntervalMs: 30_000, batchSize: 50, stallThresholdMs: 60_000 };
  const first = new RelationalLifecycleScheduler(new UnitOfWork(firstDatabase), config, new WorkerMetrics());
  const second = new RelationalLifecycleScheduler(new UnitOfWork(secondDatabase), config, new WorkerMetrics());
  t.after(async () => { await first.stop(); await second.stop(); await firstDatabase.close(); await secondDatabase.close(); });
  const [one, two] = await Promise.all([first.runOnce(), second.runOnce()]);
  assert.equal(one.savingsMaturities + two.savingsMaturities, 1);
  assert.equal((await firstDatabase.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM savings_maturity_operations WHERE deposit_id = $1 AND status = 'SUCCEEDED'", [opening.depositId])).rows[0]?.count, "1");
  assert.equal(first.health().status, "ok");
  assert.equal(second.health().status, "ok");
});
