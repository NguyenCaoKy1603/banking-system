import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "yaml";

import {
  calculateBudgetBalance,
  calculateSavingsPlan,
} from "../financialAdvice/calculations.js";
import { validateFinancialAdviceRequest } from "../financialAdvice/validation.js";
import type {
  FinancialAdviceBudgetRequest,
  FinancialAdviceSavingsRequest,
} from "../financialAdvice/types.js";

const testFile = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(testFile), "../../..");
const openApiPath = resolve(repositoryRoot, "documents/api/banking-mvp.openapi.yaml");

function readOpenApiDocument(): Record<string, any> {
  return parse(readFileSync(openApiPath, "utf8"));
}

test("C-01: OpenAPI document has /assistant/financial-advice path and valid operation", () => {
  const doc = readOpenApiDocument();
  const pathItem = doc.paths?.["/assistant/financial-advice"];
  assert.ok(pathItem, "Path /assistant/financial-advice must exist in OpenAPI.");
  assert.ok(pathItem.post, "Operation POST /assistant/financial-advice must exist.");
  assert.equal(pathItem.post.operationId, "getFinancialAdvice");
  assert.ok(pathItem.post.responses["200"], "200 response must exist.");
  assert.ok(pathItem.post.responses["413"], "413 response must exist.");
  assert.ok(pathItem.post.responses["503"], "503 response must exist.");
});

test("C-02: OpenAPI FinancialAdviceRequest example validates with runtime parser", () => {
  const doc = readOpenApiDocument();
  const example = doc.components?.schemas?.FinancialAdviceRequest?.example;
  assert.ok(example, "Example for FinancialAdviceRequest must exist.");

  const validated = validateFinancialAdviceRequest(example);
  assert.equal(validated.kind, "SAVINGS_PLAN");

  const calc = calculateSavingsPlan(validated as FinancialAdviceSavingsRequest);
  assert.equal(calc.goalStatus, "GAP");
  assert.equal(calc.budgetStatus, "SURPLUS");
  assert.equal(calc.metrics.requiredMonthlySavingsMinor, "2000000");
  assert.equal(calc.metrics.suggestedMonths, 7);
});

test("C-03: OpenAPI FinancialAdviceBudgetRequest validates with runtime parser", () => {
  const budgetPayload: FinancialAdviceBudgetRequest = {
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

  const validated = validateFinancialAdviceRequest(budgetPayload);
  assert.equal(validated.kind, "BUDGET_BALANCE");

  const calc = calculateBudgetBalance(validated as FinancialAdviceBudgetRequest);
  assert.equal(calc.budgetStatus, "SURPLUS");
  assert.equal(calc.savingsTargetStatus, "GAP");
  assert.equal(calc.metrics.capacityAfterBufferMinor, "1000000");
  assert.equal(calc.metrics.targetGapMinor, "1000000");
  assert.equal(calc.metrics.remainingAfterTargetMinor, "-1000000");
});
