import type { PoolClient } from "pg";

import { RelationalConflictError } from "./commandErrors.js";

const STEP_UP_METHODS = new Set(["OTP", "TOTP", "BIOMETRIC"]);

export type ControlPolicyDbRow = {
  config_version: string;
  global_kill_switch: boolean;
  transfers_enabled: boolean;
  allowlist_enabled: boolean;
  max_transfer_amount_minor: string;
  daily_transfer_limit_minor?: string;
  transfer_fee_minor?: string;
  step_up_methods: string[];
  savings_enabled: boolean;
  savings_allowlist_enabled: boolean;
  max_savings_amount_minor: string;
  savings_step_up_methods: string[];
  credit_enabled: boolean;
  credit_allowlisted: boolean;
  credit_payments_enabled: boolean;
  card_controls_enabled: boolean;
  max_credit_payment_amount_minor: string;
  credit_payment_step_up_methods: string[];
  card_unlock_step_up_methods: string[];
  updated_at: Date | string;
};

const DEFAULT_DAILY_TRANSFER_LIMIT_MINOR = "50000000";
const DEFAULT_TRANSFER_FEE_MINOR = "1000";

function unavailable(): never {
  throw new RelationalConflictError(
    "CONTROL_POLICY_UNAVAILABLE",
    "Control policy is unavailable or invalid.",
  );
}

function positiveMinor(value: unknown): bigint {
  try {
    const parsed = BigInt(String(value));
    if (parsed <= 0n) unavailable();
    return parsed;
  } catch {
    unavailable();
  }
}

function nonNegativeMinor(value: unknown): bigint {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 0n) unavailable();
    return parsed;
  } catch {
    unavailable();
  }
}

function methods(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) unavailable();
  const normalized = value.map((item) => String(item));
  if (normalized.some((item) => !STEP_UP_METHODS.has(item))) unavailable();
  return normalized;
}

function requireRuntimeTotp(value: unknown, code: string, message: string): void {
  // Relational-v2 currently verifies only persistent TOTP challenges at its
  // HTTP boundary. A policy that lists OTP/biometric but omits TOTP is not an
  // executable policy and must fail closed rather than advertising a method
  // that the command cannot verify.
  if (!methods(value).includes("TOTP")) {
    throw new RelationalConflictError(code, message);
  }
}

/**
 * Reads and enforces the database control policy.  This class intentionally
 * accepts a PoolClient so a command can re-check the policy inside its own
 * transaction immediately before any balance or financial mutation.
 */
export class ControlPolicyRepository {
  constructor(private readonly client: PoolClient) {}

  async read(): Promise<ControlPolicyDbRow> {
    try {
      const result = await this.client.query<ControlPolicyDbRow>(
        `SELECT config_version, global_kill_switch, transfers_enabled,
                allowlist_enabled, max_transfer_amount_minor,
                daily_transfer_limit_minor, transfer_fee_minor, step_up_methods,
                savings_enabled, savings_allowlist_enabled, max_savings_amount_minor,
                savings_step_up_methods, credit_enabled, credit_allowlisted,
                credit_payments_enabled, card_controls_enabled,
                max_credit_payment_amount_minor, credit_payment_step_up_methods,
                card_unlock_step_up_methods, updated_at
           FROM control_policy
          WHERE singleton = true
          FOR SHARE`,
      );
      const row = result.rows[0];
      if (!row || typeof row.config_version !== "string" || !row.config_version.trim()) unavailable();
      // Validate every field that can affect a command.  A malformed policy
      // must fail closed rather than falling back to process environment.
      positiveMinor(row.max_transfer_amount_minor);
      if (row.daily_transfer_limit_minor !== undefined && row.daily_transfer_limit_minor !== null) {
        positiveMinor(row.daily_transfer_limit_minor);
      }
      if (row.transfer_fee_minor !== undefined && row.transfer_fee_minor !== null) {
        nonNegativeMinor(row.transfer_fee_minor);
      }
      positiveMinor(row.max_savings_amount_minor);
      positiveMinor(row.max_credit_payment_amount_minor);
      methods(row.step_up_methods);
      methods(row.savings_step_up_methods);
      methods(row.credit_payment_step_up_methods);
      methods(row.card_unlock_step_up_methods);
      return row;
    } catch (error) {
      if (error instanceof RelationalConflictError) throw error;
      unavailable();
    }
  }

  getTransferFeeMinor(policy: ControlPolicyDbRow): bigint {
    return nonNegativeMinor(policy.transfer_fee_minor ?? DEFAULT_TRANSFER_FEE_MINOR);
  }

  async assertTransferAllowed(customerId: string, amountMinor: bigint): Promise<ControlPolicyDbRow> {
    const policy = await this.read();
    if (policy.global_kill_switch || !policy.transfers_enabled) {
      throw new RelationalConflictError("TRANSFER_DISABLED", "Transfers are temporarily unavailable.");
    }
    if (amountMinor <= 0n || amountMinor > positiveMinor(policy.max_transfer_amount_minor)) {
      throw new RelationalConflictError("TRANSFER_LIMIT_EXCEEDED", "Transfer amount exceeds the current policy limit.");
    }
    const dailyLimit = positiveMinor(
      policy.daily_transfer_limit_minor ?? DEFAULT_DAILY_TRANSFER_LIMIT_MINOR,
    );
    const dailyResult = await this.client.query<{ daily_total_minor?: string }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS daily_total_minor
         FROM transfers
        WHERE customer_id = $1
          AND status = 'SUCCEEDED'
          AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
      [customerId],
    );
    const dailyTotal = BigInt(String(dailyResult.rows[0]?.daily_total_minor ?? "0"));
    if (dailyTotal + amountMinor > dailyLimit) {
      throw new RelationalConflictError(
        "DAILY_TRANSFER_LIMIT_EXCEEDED",
        "Tổng số tiền chuyển trong ngày vượt quá hạn mức cho phép.",
      );
    }
    if (policy.allowlist_enabled) {
      const entitlement = await this.client.query(
        `SELECT 1 FROM customer_feature_entitlements
          WHERE customer_id = $1 AND feature_code = 'TRANSFERS' AND enabled = true`,
        [customerId],
      );
      if ((entitlement.rowCount ?? 0) !== 1) {
        throw new RelationalConflictError("TRANSFER_NOT_ALLOWLISTED", "Transfers are not enabled for this customer.");
      }
    }
    requireRuntimeTotp(policy.step_up_methods, "TRANSFER_STEP_UP_REQUIRED", "A supported transfer TOTP step-up method is not configured.");
    return policy;
  }

  async assertSavingsOpeningAllowed(customerId: string, amountMinor: bigint): Promise<void> {
    const policy = await this.read();
    if (policy.global_kill_switch || !policy.savings_enabled) {
      throw new RelationalConflictError("SAVINGS_DISABLED", "Savings opening is temporarily unavailable.");
    }
    if (amountMinor <= 0n || amountMinor > positiveMinor(policy.max_savings_amount_minor)) {
      throw new RelationalConflictError("SAVINGS_LIMIT_EXCEEDED", "Savings principal exceeds the current policy limit.");
    }
    if (policy.savings_allowlist_enabled) await this.assertEntitled(customerId, "SAVINGS");
    requireRuntimeTotp(policy.savings_step_up_methods, "SAVINGS_STEP_UP_REQUIRED", "A supported savings TOTP step-up method is not configured.");
  }

  async assertCreditApplicationAllowed(customerId: string): Promise<void> {
    const policy = await this.read();
    if (policy.global_kill_switch || !policy.credit_enabled) {
      throw new RelationalConflictError("CREDIT_DISABLED", "Credit applications are temporarily unavailable.");
    }
    if (policy.credit_allowlisted) await this.assertEntitled(customerId, "CREDIT");
  }

  /** Repayment remains available while new credit is frozen. */
  async assertCreditPaymentAllowed(customerId: string, amountMinor?: bigint): Promise<bigint> {
    const policy = await this.read();
    if (!policy.credit_payments_enabled) {
      throw new RelationalConflictError("CREDIT_PAYMENTS_DISABLED", "Credit repayment is temporarily unavailable.");
    }
    if (amountMinor !== undefined && amountMinor > positiveMinor(policy.max_credit_payment_amount_minor)) {
      throw new RelationalConflictError("CREDIT_PAYMENT_LIMIT_EXCEEDED", "Credit payment exceeds the current policy limit.");
    }
    requireRuntimeTotp(policy.credit_payment_step_up_methods, "CREDIT_PAYMENT_STEP_UP_REQUIRED", "A supported credit-payment TOTP step-up method is not configured.");
    return positiveMinor(policy.max_credit_payment_amount_minor);
  }

  async assertCardUnlockAllowed(customerId: string): Promise<void> {
    const policy = await this.read();
    if (policy.global_kill_switch || !policy.card_controls_enabled) {
      throw new RelationalConflictError("CARD_CONTROLS_DISABLED", "Card controls are temporarily unavailable.");
    }
    if (policy.credit_allowlisted) await this.assertEntitled(customerId, "CREDIT");
    requireRuntimeTotp(policy.card_unlock_step_up_methods, "CARD_UNLOCK_STEP_UP_REQUIRED", "A supported card-unlock TOTP step-up method is not configured.");
  }

  private async assertEntitled(customerId: string, featureCode: "TRANSFERS" | "SAVINGS" | "CREDIT"): Promise<void> {
    const result = await this.client.query(
      `SELECT 1 FROM customer_feature_entitlements
        WHERE customer_id = $1 AND feature_code = $2 AND enabled = true`,
      [customerId, featureCode],
    );
    if ((result.rowCount ?? 0) !== 1) {
      throw new RelationalConflictError("FEATURE_NOT_ALLOWLISTED", "This feature is not enabled for the customer.");
    }
  }
}
