import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient } from "pg";

import { RelationalCreditService } from "../database/creditService.js";
import type { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";

function createMockUnitOfWork(
  onQuery: (sql: string, params: unknown[]) => { rows: Record<string, unknown>[]; rowCount?: number },
): UnitOfWork {
  const queries: string[] = [];
  const client = {
    async query(sqlText: string, params: unknown[] = []) {
      const normalized = sqlText.replace(/\s+/g, " ").trim();
      queries.push(normalized);
      if (normalized.startsWith("BEGIN") || normalized === "COMMIT" || normalized === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes("FROM control_policy")) {
        return {
          rows: [{
            config_version: "p0-test-v1",
            global_kill_switch: false,
            transfers_enabled: true,
            allowlist_enabled: false,
            max_transfer_amount_minor: "50000000",
            step_up_methods: ["TOTP"],
            savings_enabled: true,
            savings_allowlist_enabled: false,
            max_savings_amount_minor: "100000000",
            savings_step_up_methods: ["TOTP"],
            credit_enabled: true,
            credit_allowlisted: false,
            credit_payments_enabled: true,
            card_controls_enabled: true,
            max_credit_payment_amount_minor: "50000000",
            credit_payment_step_up_methods: ["TOTP"],
            card_unlock_step_up_methods: ["TOTP"],
            updated_at: new Date().toISOString(),
          }],
          rowCount: 1,
        };
      }
      return onQuery(normalized, params);
    },
    release() {},
  };

  const mockPool = {
    async connect() {
      return client as unknown as PoolClient;
    },
  } as unknown as DatabasePool;

  const uow = new UnitOfWork(mockPool);
  return Object.assign(uow, { queries });
}

test("RelationalCreditService.submitApplication rejects customers without APPROVED KYC before reserving idempotency", async () => {
  const customerId = randomUUID();
  let reservedIdempotency = false;

  const uow = createMockUnitOfWork((sql) => {
    if (sql.includes("FROM kyc_applications")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("credit_idempotency")) {
      reservedIdempotency = true;
    }
    return { rows: [], rowCount: 0 };
  });

  const credit = new RelationalCreditService(uow);
  await assert.rejects(
    credit.submitApplication({
      customerId,
      idempotencyKey: "credit-app-no-kyc-1234",
      request: { requestedLimit: { currency: "VND", amountMinor: "20000000" }, stepUp: { method: "TOTP", proof: "123456" } },
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string; status?: number }).code === "KYC_REQUIRED" &&
      (error as { status?: number }).status === 409,
  );
  assert.equal(reservedIdempotency, false);
});

test("RelationalCreditService.submitApplication proceeds when customer has APPROVED KYC", async () => {
  const customerId = randomUUID();
  const applicationId = randomUUID();
  const now = new Date().toISOString();

  const uow = createMockUnitOfWork((sql) => {
    if (sql.includes("FROM kyc_applications")) {
      return { rows: [{ status: "APPROVED" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO credit_idempotency")) {
      return { rows: [{ created: true }], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM credit_applications WHERE customer_id")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO credit_applications")) {
      return {
        rows: [{
          id: applicationId,
          requested_limit_minor: "20000000",
          approved_limit_minor: null,
          status: "SUBMITTED",
          decision_reason_code: null,
          credit_account_id: null,
          created_at: now,
          updated_at: now,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const credit = new RelationalCreditService(uow);
  const result = await credit.submitApplication({
    customerId,
    idempotencyKey: "credit-app-approved-kyc-1",
    request: { requestedLimit: { currency: "VND", amountMinor: "20000000" }, stepUp: { method: "TOTP", proof: "123456" } },
  });

  assert.equal(result.applicationId, applicationId);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(result.requestedLimit.amountMinor, "20000000");
});
