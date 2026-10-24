import { DomainError } from "../errors.js";
import type {
  FinancialAdviceBudgetRequest,
  FinancialAdviceRequest,
  FinancialAdviceSavingsRequest,
  FinancialPreference,
} from "./types.js";

const CANONICAL_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
const MAX_MONEY_MINOR = 1_000_000_000_000n; // 1 nghìn tỷ VND

const ALLOWED_PREFERENCES: ReadonlySet<string> = new Set<FinancialPreference>([
  "KEEP_TARGET",
  "KEEP_CURRENT_SPENDING",
  "BALANCED",
]);

const COMMON_KEYS = new Set([
  "schemaVersion",
  "kind",
  "currency",
  "monthlyIncomeMinor",
  "essentialExpensesMinor",
  "flexibleExpensesMinor",
  "monthlyDebtPaymentsMinor",
  "monthlyBufferMinor",
  "preference",
  "inputConfirmed",
]);

const GOAL_KEYS = new Set([
  "targetAmountMinor",
  "alreadySavedMinor",
  "months",
]);

function validateMoneyField(
  val: unknown,
  fieldName: string,
  fieldErrors: Record<string, string>,
  options: { allowZero: boolean } = { allowZero: true },
): void {
  if (typeof val !== "string") {
    fieldErrors[fieldName] = "Must be a string representing an integer amount.";
    return;
  }
  if (!CANONICAL_INTEGER_PATTERN.test(val)) {
    fieldErrors[fieldName] = "Invalid integer format; must be non-negative without leading zeroes, decimals or symbols.";
    return;
  }
  try {
    const bigVal = BigInt(val);
    if (!options.allowZero && bigVal <= 0n) {
      fieldErrors[fieldName] = "Amount must be strictly greater than 0.";
      return;
    }
    if (bigVal > MAX_MONEY_MINOR) {
      fieldErrors[fieldName] = "Amount exceeds maximum allowed limit (1,000,000,000,000 VND).";
      return;
    }
  } catch {
    fieldErrors[fieldName] = "Invalid numeric value.";
  }
}

export function validateFinancialAdviceRequest(payload: unknown): FinancialAdviceRequest {
  const fieldErrors: Record<string, string> = {};

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DomainError(422, "VALIDATION_ERROR", "Request body must be a JSON object.", {
      body: "Expected a valid JSON object.",
    });
  }

  const raw = payload as Record<string, unknown>;

  // Check schemaVersion
  if (raw.schemaVersion !== "1") {
    fieldErrors.schemaVersion = "schemaVersion must be '1'.";
  }

  // Check currency
  if (raw.currency !== "VND") {
    fieldErrors.currency = "currency must be 'VND'.";
  }

  // Check kind
  const kind = raw.kind;
  if (kind !== "SAVINGS_PLAN" && kind !== "BUDGET_BALANCE") {
    fieldErrors.kind = "kind must be either 'SAVINGS_PLAN' or 'BUDGET_BALANCE'.";
  }

  // Check preference
  if (typeof raw.preference !== "string" || !ALLOWED_PREFERENCES.has(raw.preference)) {
    fieldErrors.preference = "preference must be 'KEEP_TARGET', 'KEEP_CURRENT_SPENDING', or 'BALANCED'.";
  }

  // Check inputConfirmed
  if (raw.inputConfirmed !== true) {
    fieldErrors.inputConfirmed = "inputConfirmed must be true.";
  }

  // Common money fields
  validateMoneyField(raw.monthlyIncomeMinor, "monthlyIncomeMinor", fieldErrors, { allowZero: true });
  validateMoneyField(raw.essentialExpensesMinor, "essentialExpensesMinor", fieldErrors, { allowZero: true });
  validateMoneyField(raw.flexibleExpensesMinor, "flexibleExpensesMinor", fieldErrors, { allowZero: true });
  validateMoneyField(raw.monthlyDebtPaymentsMinor, "monthlyDebtPaymentsMinor", fieldErrors, { allowZero: true });
  validateMoneyField(raw.monthlyBufferMinor, "monthlyBufferMinor", fieldErrors, { allowZero: true });

  if (kind === "SAVINGS_PLAN") {
    // Check extra root keys
    for (const key of Object.keys(raw)) {
      if (!COMMON_KEYS.has(key) && key !== "goal") {
        fieldErrors[key] = `Unknown field '${key}' for SAVINGS_PLAN request.`;
      }
    }

    if (!raw.goal || typeof raw.goal !== "object" || Array.isArray(raw.goal)) {
      fieldErrors.goal = "goal must be an object for SAVINGS_PLAN.";
    } else {
      const goalRaw = raw.goal as Record<string, unknown>;
      for (const gKey of Object.keys(goalRaw)) {
        if (!GOAL_KEYS.has(gKey)) {
          fieldErrors[`goal.${gKey}`] = `Unknown field 'goal.${gKey}'.`;
        }
      }

      validateMoneyField(goalRaw.targetAmountMinor, "goal.targetAmountMinor", fieldErrors, { allowZero: false });
      validateMoneyField(goalRaw.alreadySavedMinor, "goal.alreadySavedMinor", fieldErrors, { allowZero: true });

      const months = goalRaw.months;
      if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 120) {
        fieldErrors["goal.months"] = "goal.months must be an integer between 1 and 120.";
      }
    }
  } else if (kind === "BUDGET_BALANCE") {
    // Check extra root keys
    for (const key of Object.keys(raw)) {
      if (!COMMON_KEYS.has(key) && key !== "monthlySavingsTargetMinor") {
        fieldErrors[key] = `Unknown field '${key}' for BUDGET_BALANCE request.`;
      }
    }

    validateMoneyField(
      raw.monthlySavingsTargetMinor,
      "monthlySavingsTargetMinor",
      fieldErrors,
      { allowZero: true },
    );
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new DomainError(422, "VALIDATION_ERROR", "Financial advice request validation failed.", fieldErrors);
  }

  return raw as unknown as FinancialAdviceRequest;
}
