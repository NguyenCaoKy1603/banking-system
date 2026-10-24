import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalRemainingService } from "../database/remainingService.js";
import { RelationalTransferService } from "../database/transferService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });

function accountNumber(id: string): string {
  return `9704${(Number.parseInt(id.replaceAll("-", "").slice(0, 8), 16) % 100000000).toString().padStart(8, "0")}`;
}

async function customer(database: DatabasePool, label: string): Promise<{ customerId: string; accountId: string; accountNumber: string }> {
  const customerId = randomUUID();
  const accountId = randomUUID();
  const number = accountNumber(accountId);
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, $2, $3, $4, 'salt', 'digest', NOW())`,
    [customerId, label, `${label.toLowerCase().replaceAll(" ", "-")}-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO payment_accounts
      (id, customer_id, display_name, masked_number, currency, available_minor,
       current_minor, status, version, updated_at, account_number, bank_name,
       opening_balance_minor, held_minor)
     VALUES ($1, $2, 'Reference account', $3, 'VND', 10000000, 10000000,
             'ACTIVE', 0, NOW(), $4, 'Reference Bank', 0, 0)`,
    [accountId, customerId, `•••• ${number.slice(-4)}`, number],
  );
  return { customerId, accountId, accountNumber: number };
}

test("recipient lookup is persistent, hashed and usable by relational transfer quote", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const source = await customer(database, "Remaining Source");
  const target = await customer(database, "Remaining Target");
  const remaining = new RelationalRemainingService(new UnitOfWork(database));
  const transfer = new RelationalTransferService(new UnitOfWork(database));
  t.after(() => database.close());

  const lookup = await remaining.lookupRecipient(source.customerId, target.accountNumber);
  assert.equal(lookup.accountHolderName, "Remaining Target");
  const stored = await database.query<{ token_hash: string; expires_at: string }>("SELECT token_hash, expires_at FROM recipient_lookups WHERE customer_id = $1", [source.customerId]);
  assert.equal(stored.rows.length, 1);
  assert.notEqual(stored.rows[0]?.token_hash, lookup.lookupId);
  assert.ok(Date.parse(stored.rows[0]!.expires_at) > Date.now());

  const quote = await transfer.createQuote({ customerId: source.customerId, sourceAccountId: source.accountId, lookupId: lookup.lookupId, amount: { currency: "VND", amountMinor: "1000000" } });
  assert.equal(quote.beneficiary.id, lookup.lookupId);
  assert.equal(quote.beneficiary.accountHolderName, "Remaining Target");
});

test("notifications use relational ownership", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl, max: 8 });
  const owner = await customer(database, "Remaining Notifications Owner");
  const transactionId = randomUUID();
  const notificationId = randomUUID();
  await database.query(
    `INSERT INTO notifications
      (id, customer_id, notification_type, title, body, resource_id,
       resource_account_id, is_read, created_at)
     VALUES ($1, $2, 'SECURITY', 'Test notification', 'Body', $3, $4, false, NOW())`,
    [notificationId, owner.customerId, transactionId, owner.accountId],
  );
  const remaining = new RelationalRemainingService(new UnitOfWork(database));
  t.after(() => database.close());

  const notifications = await remaining.listNotifications(owner.customerId);
  assert.equal(notifications.length, 1);
  assert.equal((await remaining.markNotificationRead(owner.customerId, notificationId)).read, true);
  assert.equal((await remaining.listNotifications(owner.customerId))[0]?.read, true);

});
