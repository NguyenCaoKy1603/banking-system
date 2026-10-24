import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryLedger } from "../domain/ledger.js";

test("ledger accepts balanced double-entry journals and is idempotent", () => {
  const ledger = new InMemoryLedger();
  const journal = {
    journalId: "journal-1",
    occurredAt: "2026-08-14T00:00:00.000Z",
    entries: [
      {
        accountId: "customer:1",
        side: "DEBIT" as const,
        amountMinor: 101_000n,
        currency: "VND" as const,
      },
      {
        accountId: "settlement:VND",
        side: "CREDIT" as const,
        amountMinor: 100_000n,
        currency: "VND" as const,
      },
      {
        accountId: "fee-income:VND",
        side: "CREDIT" as const,
        amountMinor: 1_000n,
        currency: "VND" as const,
      },
    ],
  };

  const first = ledger.append(journal);
  const second = ledger.append(journal);

  assert.equal(first.length, 3);
  assert.deepEqual(second, first);
  assert.equal(ledger.isBalanced("journal-1"), true);
  assert.equal(ledger.listEntries("customer:1").length, 1);
  assert.equal(ledger.getNetBalance("customer:1"), -101_000n);
});

test("ledger rejects unbalanced and non-positive entries", () => {
  const ledger = new InMemoryLedger();
  assert.throws(
    () =>
      ledger.append({
        journalId: "unbalanced",
        occurredAt: "2026-08-14T00:00:00.000Z",
        entries: [
          {
            accountId: "customer:1",
            side: "DEBIT",
            amountMinor: 100n,
            currency: "VND",
          },
          {
            accountId: "settlement:VND",
            side: "CREDIT",
            amountMinor: 99n,
            currency: "VND",
          },
        ],
      }),
    /balanced/,
  );

  assert.throws(
    () =>
      ledger.append({
        journalId: "zero",
        occurredAt: "2026-08-14T00:00:00.000Z",
        entries: [
          {
            accountId: "customer:1",
            side: "DEBIT",
            amountMinor: 0n,
            currency: "VND",
          },
          {
            accountId: "settlement:VND",
            side: "CREDIT",
            amountMinor: 0n,
            currency: "VND",
          },
        ],
      }),
    /positive/,
  );
});
