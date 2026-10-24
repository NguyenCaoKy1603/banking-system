import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBudgetBalance,
  calculateSavingsPlan,
  ceilDiv,
  formatSignedMinor,
  formatVnd,
} from "../financialAdvice/calculations.js";
import {
  generateBudgetOptions,
  generateBudgetWarnings,
  generateSavingsOptions,
  generateSavingsWarnings,
  getAllowedReasonIds,
  selectFallbackOption,
  selectFallbackReasons,
} from "../financialAdvice/options.js";
import {
  renderBudgetParagraphs,
  renderSavingsParagraphs,
} from "../financialAdvice/explanationCatalog.js";
import { validateFinancialAdviceRequest } from "../financialAdvice/validation.js";
import { DomainError } from "../errors.js";
import type {
  FinancialAdviceBudgetRequest,
  FinancialAdviceSavingsRequest,
} from "../financialAdvice/types.js";

test("ceilDiv math properties", () => {
  assert.equal(ceilDiv(0n, 5n), 0n);
  assert.equal(ceilDiv(10n, 5n), 2n);
  assert.equal(ceilDiv(11n, 5n), 3n);
  assert.equal(ceilDiv(14n, 5n), 3n);
  assert.equal(ceilDiv(15n, 5n), 3n);
  assert.throws(() => ceilDiv(10n, 0n));
});

test("formatSignedMinor & formatVnd formatting", () => {
  assert.equal(formatSignedMinor(0n), "0");
  assert.equal(formatSignedMinor(500000n), "500000");
  assert.equal(formatSignedMinor(-500000n), "-500000");

  assert.equal(formatVnd(0n), "0 ₫");
  assert.equal(formatVnd(10000000n), "10.000.000 ₫");
  assert.equal(formatVnd(-1000000n), "-1.000.000 ₫");
});

test("S-01: Standard savings gap with all 3 options", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "10000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "0",
    preference: "KEEP_CURRENT_SPENDING",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "12000000",
      alreadySavedMinor: "2000000",
      months: 5,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.budgetStatus, "SURPLUS");
  assert.equal(calc.goalStatus, "GAP");
  assert.equal(calc.metrics.declaredOutgoingsMinor, "8500000");
  assert.equal(calc.metrics.unallocatedBeforeBufferMinor, "1500000");
  assert.equal(calc.metrics.capacityAfterBufferMinor, "1500000");
  assert.equal(calc.metrics.bufferShortfallMinor, "0");
  assert.equal(calc.metrics.remainingGoalMinor, "10000000");
  assert.equal(calc.metrics.requiredMonthlySavingsMinor, "2000000");
  assert.equal(calc.metrics.monthlyGapMinor, "500000");
  assert.equal(calc.metrics.achievableGoalAtDeadlineMinor, "9500000");
  assert.equal(calc.metrics.suggestedMonths, 7);
  assert.equal(calc.metrics.horizonExceeded, false);

  const options = generateSavingsOptions(calc);
  assert.equal(options.length, 3);
  assert.equal(options[0].id, "EXTEND_DEADLINE");
  assert.equal((options[0].changes as { months: number }).months, 7);
  assert.equal(options[1].id, "REDUCE_FLEXIBLE_SPENDING");
  assert.equal((options[1].changes as { reductionMinor: string }).reductionMinor, "500000");
  assert.equal(options[2].id, "LOWER_GOAL_AMOUNT");
  assert.equal((options[2].changes as { targetAmountMinor: string }).targetAmountMinor, "9500000");

  const fallback = selectFallbackOption(options, req.preference, true);
  assert.equal(fallback, "EXTEND_DEADLINE");
});

test("S-02: Surplus feasible with maintain plan", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "11000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "12000000",
      alreadySavedMinor: "2000000",
      months: 5,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.goalStatus, "FEASIBLE");
  assert.equal(calc.metrics.capacityAfterBufferMinor, "2500000");
  assert.equal(calc.metrics.requiredMonthlySavingsMinor, "2000000");
  assert.equal(calc.metrics.monthlyGapMinor, "0");

  const options = generateSavingsOptions(calc);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, "MAINTAIN_PLAN");
});

test("S-03: Feasible exactly equal (C === Q)", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "10500000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "12000000",
      alreadySavedMinor: "2000000",
      months: 5,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.goalStatus, "FEASIBLE");
  assert.equal(calc.metrics.capacityAfterBufferMinor, "2000000");
  assert.equal(calc.metrics.requiredMonthlySavingsMinor, "2000000");
  assert.equal(calc.metrics.monthlyGapMinor, "0");

  const options = generateSavingsOptions(calc);
  assert.equal(options[0].id, "MAINTAIN_PLAN");
});

test("S-04 & S-05: Already funded", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "10000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "12000000",
      alreadySavedMinor: "13000000", // > target
      months: 5,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.goalStatus, "ALREADY_FUNDED");
  assert.equal(calc.metrics.remainingGoalMinor, "0");
  assert.equal(calc.metrics.requiredMonthlySavingsMinor, "0");
  assert.equal(calc.metrics.suggestedMonths, 0);

  const options = generateSavingsOptions(calc);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, "GOAL_ALREADY_FUNDED");
});

test("S-06: Already funded with base budget deficit", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "5000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "10000000",
      alreadySavedMinor: "10000000",
      months: 5,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.goalStatus, "ALREADY_FUNDED");
  assert.equal(calc.budgetStatus, "DEFICIT");

  const warnings = generateSavingsWarnings(calc);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "BASE_BUDGET_DEFICIT");
});

test("S-07 & S-08: NO_CAPACITY when C <= 0", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "5000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "10000000",
      alreadySavedMinor: "0",
      months: 5,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.goalStatus, "NO_CAPACITY");
  assert.equal(calc.metrics.suggestedMonths, null);

  const options = generateSavingsOptions(calc);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, "REVIEW_BASE_BUDGET");
});

test("S-10: ceilDiv rounding (R = 10, H = 3 => Q = 4)", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "100",
    essentialExpensesMinor: "0",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "10",
      alreadySavedMinor: "0",
      months: 3,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.metrics.requiredMonthlySavingsMinor, "4");
  assert.equal(calc.goalStatus, "FEASIBLE");
});

test("S-11: Horizon exceeded when H2 > 120", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "1",
    essentialExpensesMinor: "0",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "121",
      alreadySavedMinor: "0",
      months: 120,
    },
  };

  const calc = calculateSavingsPlan(req);
  assert.equal(calc.metrics.suggestedMonths, null);
  assert.equal(calc.metrics.horizonExceeded, true);

  const options = generateSavingsOptions(calc);
  assert.ok(!options.some((o) => o.id === "EXTEND_DEADLINE"));
});

test("S-13 & S-14: Flexible spending cut boundary", () => {
  // J = 500k, F = 500k => valid cut
  const req1: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "1500000",
    essentialExpensesMinor: "500000",
    flexibleExpensesMinor: "500000",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "5000000",
      alreadySavedMinor: "0",
      months: 5,
    },
  };
  const calc1 = calculateSavingsPlan(req1);
  const options1 = generateSavingsOptions(calc1);
  assert.ok(options1.some((o) => o.id === "REDUCE_FLEXIBLE_SPENDING"));

  // J = 500k, F = 499.999 => cannot cut flexible expenses enough
  const req2: FinancialAdviceSavingsRequest = {
    ...req1,
    flexibleExpensesMinor: "499999",
    essentialExpensesMinor: "500001",
  };
  const calc2 = calculateSavingsPlan(req2);
  const options2 = generateSavingsOptions(calc2);
  assert.ok(!options2.some((o) => o.id === "REDUCE_FLEXIBLE_SPENDING"));
});

test("S-15: Buffer shortfall calculation", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "1500000",
    essentialExpensesMinor: "1000000",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "1000000", // wanting 1tr buffer but only 500k surplus
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "5000000",
      alreadySavedMinor: "0",
      months: 5,
    },
  };
  const calc = calculateSavingsPlan(req);
  assert.equal(calc.metrics.unallocatedBeforeBufferMinor, "500000");
  assert.equal(calc.metrics.capacityAfterBufferMinor, "-500000");
  assert.equal(calc.metrics.bufferShortfallMinor, "500000");
});

test("S-16: Upper bound 1e12 calculation without overflow", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "1000000000000",
    essentialExpensesMinor: "1000000000000",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "BALANCED",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "1000000000000",
      alreadySavedMinor: "0",
      months: 120,
    },
  };
  const calc = calculateSavingsPlan(req);
  assert.equal(calc.metrics.declaredOutgoingsMinor, "1000000000000");
  assert.equal(calc.goalStatus, "NO_CAPACITY");
});

test("S-17 & S-18: Fallback option based on preference", () => {
  const req: FinancialAdviceSavingsRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "10000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "12000000",
      alreadySavedMinor: "2000000",
      months: 5,
    },
  };
  const calc = calculateSavingsPlan(req);
  const options = generateSavingsOptions(calc);

  const fallbackTarget = selectFallbackOption(options, "KEEP_TARGET", true);
  assert.equal(fallbackTarget, "REDUCE_FLEXIBLE_SPENDING");

  const fallbackSpending = selectFallbackOption(options, "KEEP_CURRENT_SPENDING", true);
  assert.equal(fallbackSpending, "EXTEND_DEADLINE");

  const fallbackBalanced = selectFallbackOption(options, "BALANCED", true);
  assert.equal(fallbackBalanced, "EXTEND_DEADLINE");
});

test("S-20: Invariant input immutability & deterministic output", () => {
  const req: FinancialAdviceSavingsRequest = Object.freeze({
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "10000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "0",
    preference: "KEEP_CURRENT_SPENDING",
    inputConfirmed: true,
    goal: Object.freeze({
      targetAmountMinor: "12000000",
      alreadySavedMinor: "2000000",
      months: 5,
    }),
  });

  const calc1 = calculateSavingsPlan(req);
  const calc2 = calculateSavingsPlan(req);
  assert.deepEqual(calc1, calc2);
});

// -------------------------------------------------------------
// UC-FA02: Budget Balance Tests
// -------------------------------------------------------------
test("B-01: Standard budget gap example", () => {
  const req: FinancialAdviceBudgetRequest = {
    schemaVersion: "1",
    kind: "BUDGET_BALANCE",
    currency: "VND",
    monthlyIncomeMinor: "10000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "500000",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    monthlySavingsTargetMinor: "2000000",
  };

  const calc = calculateBudgetBalance(req);
  assert.equal(calc.budgetStatus, "SURPLUS");
  assert.equal(calc.savingsTargetStatus, "GAP");
  assert.equal(calc.metrics.declaredOutgoingsMinor, "8500000");
  assert.equal(calc.metrics.unallocatedBeforeBufferMinor, "1500000");
  assert.equal(calc.metrics.capacityAfterBufferMinor, "1000000");
  assert.equal(calc.metrics.maximumSavingsAtCurrentBudgetMinor, "1000000");
  assert.equal(calc.metrics.targetGapMinor, "1000000");
  assert.equal(calc.metrics.remainingAfterTargetMinor, "-1000000");
  assert.equal(calc.metrics.baseDeficitMinor, "0");
  assert.equal(calc.metrics.bufferShortfallMinor, "0");

  const options = generateBudgetOptions(calc);
  assert.equal(options.length, 2);
  assert.equal(options[0].id, "REDUCE_FLEXIBLE_SPENDING");
  assert.equal((options[0].changes as { reductionMinor: string }).reductionMinor, "1000000");
  assert.equal(options[1].id, "ADJUST_SAVINGS_TARGET");
  assert.equal((options[1].changes as { monthlySavingsTargetMinor: string }).monthlySavingsTargetMinor, "1000000");
});

test("B-02 & B-03: Budget target MET", () => {
  const req: FinancialAdviceBudgetRequest = {
    schemaVersion: "1",
    kind: "BUDGET_BALANCE",
    currency: "VND",
    monthlyIncomeMinor: "10000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "500000",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    monthlySavingsTargetMinor: "500000",
  };

  const calc = calculateBudgetBalance(req);
  assert.equal(calc.savingsTargetStatus, "MET");
  assert.equal(calc.metrics.remainingAfterTargetMinor, "500000");

  const options = generateBudgetOptions(calc);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, "MAINTAIN_BUDGET");
});

test("B-05: Zero income with expense => DEFICIT", () => {
  const req: FinancialAdviceBudgetRequest = {
    schemaVersion: "1",
    kind: "BUDGET_BALANCE",
    currency: "VND",
    monthlyIncomeMinor: "0",
    essentialExpensesMinor: "1000000",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    monthlySavingsTargetMinor: "0",
  };

  const calc = calculateBudgetBalance(req);
  assert.equal(calc.budgetStatus, "DEFICIT");
  assert.equal(calc.metrics.baseDeficitMinor, "1000000");
});

test("B-07: Flexible cut can fix deficit and meet target", () => {
  const req: FinancialAdviceBudgetRequest = {
    schemaVersion: "1",
    kind: "BUDGET_BALANCE",
    currency: "VND",
    monthlyIncomeMinor: "5000000",
    essentialExpensesMinor: "4000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    monthlySavingsTargetMinor: "1000000",
  };

  const calc = calculateBudgetBalance(req);
  assert.equal(calc.budgetStatus, "DEFICIT");
  assert.equal(calc.metrics.targetGapMinor, "2000000");

  const options = generateBudgetOptions(calc);
  assert.ok(options.some((o) => o.id === "REDUCE_FLEXIBLE_SPENDING"));
  const cutOpt = options.find((o) => o.id === "REDUCE_FLEXIBLE_SPENDING");
  assert.equal((cutOpt?.changes as { newFlexibleExpensesMinor: string }).newFlexibleExpensesMinor, "0");
});

test("B-08: Cannot cut when flexible is 0 => REVIEW_BASE_BUDGET", () => {
  const req: FinancialAdviceBudgetRequest = {
    schemaVersion: "1",
    kind: "BUDGET_BALANCE",
    currency: "VND",
    monthlyIncomeMinor: "5000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    monthlySavingsTargetMinor: "1000000",
  };

  const calc = calculateBudgetBalance(req);
  const options = generateBudgetOptions(calc);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, "REVIEW_BASE_BUDGET");
});

// -------------------------------------------------------------
// Input Validation Tests (V-01 to V-18)
// -------------------------------------------------------------
test("V-01 to V-18: Validation behavior", () => {
  // Missing required
  assert.throws(
    () => validateFinancialAdviceRequest({}),
    (err: unknown) => err instanceof DomainError && err.status === 422,
  );

  // Negative money
  assert.throws(
    () =>
      validateFinancialAdviceRequest({
        schemaVersion: "1",
        kind: "SAVINGS_PLAN",
        currency: "VND",
        monthlyIncomeMinor: "-100",
        essentialExpensesMinor: "0",
        flexibleExpensesMinor: "0",
        monthlyDebtPaymentsMinor: "0",
        monthlyBufferMinor: "0",
        preference: "KEEP_TARGET",
        inputConfirmed: true,
        goal: { targetAmountMinor: "100", alreadySavedMinor: "0", months: 5 },
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      Boolean(err.fieldErrors?.monthlyIncomeMinor),
  );

  // Non-canonical integer (e.g. leading zero "0100")
  assert.throws(
    () =>
      validateFinancialAdviceRequest({
        schemaVersion: "1",
        kind: "SAVINGS_PLAN",
        currency: "VND",
        monthlyIncomeMinor: "0100",
        essentialExpensesMinor: "0",
        flexibleExpensesMinor: "0",
        monthlyDebtPaymentsMinor: "0",
        monthlyBufferMinor: "0",
        preference: "KEEP_TARGET",
        inputConfirmed: true,
        goal: { targetAmountMinor: "100", alreadySavedMinor: "0", months: 5 },
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      Boolean(err.fieldErrors?.monthlyIncomeMinor),
  );

  // Exceeding upper bound
  assert.throws(
    () =>
      validateFinancialAdviceRequest({
        schemaVersion: "1",
        kind: "SAVINGS_PLAN",
        currency: "VND",
        monthlyIncomeMinor: "1000000000001",
        essentialExpensesMinor: "0",
        flexibleExpensesMinor: "0",
        monthlyDebtPaymentsMinor: "0",
        monthlyBufferMinor: "0",
        preference: "KEEP_TARGET",
        inputConfirmed: true,
        goal: { targetAmountMinor: "100", alreadySavedMinor: "0", months: 5 },
      }),
    (err: unknown) =>
      err instanceof DomainError &&
      Boolean(err.fieldErrors?.monthlyIncomeMinor),
  );

  // Unknown field
  assert.throws(
    () =>
      validateFinancialAdviceRequest({
        schemaVersion: "1",
        kind: "SAVINGS_PLAN",
        currency: "VND",
        monthlyIncomeMinor: "100",
        essentialExpensesMinor: "0",
        flexibleExpensesMinor: "0",
        monthlyDebtPaymentsMinor: "0",
        monthlyBufferMinor: "0",
        preference: "KEEP_TARGET",
        inputConfirmed: true,
        goal: { targetAmountMinor: "100", alreadySavedMinor: "0", months: 5 },
        secretField: "hack",
      }),
    (err: unknown) =>
      err instanceof DomainError && Boolean(err.fieldErrors?.secretField),
  );

  // Input confirmed false
  assert.throws(
    () =>
      validateFinancialAdviceRequest({
        schemaVersion: "1",
        kind: "SAVINGS_PLAN",
        currency: "VND",
        monthlyIncomeMinor: "100",
        essentialExpensesMinor: "0",
        flexibleExpensesMinor: "0",
        monthlyDebtPaymentsMinor: "0",
        monthlyBufferMinor: "0",
        preference: "KEEP_TARGET",
        inputConfirmed: false,
        goal: { targetAmountMinor: "100", alreadySavedMinor: "0", months: 5 },
      }),
    (err: unknown) =>
      err instanceof DomainError && Boolean(err.fieldErrors?.inputConfirmed),
  );

  // Total expenses exceeding income is VALID
  const validDeficit = validateFinancialAdviceRequest({
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "1000",
    essentialExpensesMinor: "5000",
    flexibleExpensesMinor: "0",
    monthlyDebtPaymentsMinor: "0",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: { targetAmountMinor: "100", alreadySavedMinor: "0", months: 5 },
  });
  assert.equal(validDeficit.monthlyIncomeMinor, "1000");
});
