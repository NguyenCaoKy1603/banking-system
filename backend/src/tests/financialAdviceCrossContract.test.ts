import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";

import { resolveAssistantConfig } from "../assistant/helpConfig.js";
import { FakeAssistantHelpProvider } from "../assistant/helpProvider.js";
import { FinancialAdviceService } from "../financialAdvice/adviceService.js";
import { validateFinancialAdviceRequest } from "../financialAdvice/validation.js";

const here = dirname(fileURLToPath(import.meta.url));
const mobileValidatorsUrl = pathToFileURL(resolve(
  here,
  "../../../mobile-app/src/features/financial-advice/validation/financialAdviceValidators.ts",
)).href;
type MobileValidatorModule = {
  validateFinancialAdviceForm(values: Record<string, unknown>): {
    isValid: boolean;
    fieldErrors: Record<string, string>;
    request?: unknown;
  };
  isFinancialAdviceResponse(payload: unknown): boolean;
};

const commonForm = {
  monthlyIncomeMinor: "10.000.000",
  essentialExpensesMinor: "6.000.000",
  flexibleExpensesMinor: "2.000.000",
  monthlyDebtPaymentsMinor: "500.000",
  monthlyBufferMinor: "0",
  preference: "KEEP_TARGET" as const,
  excludeDebtFromExpensesConfirmation: true,
};

test("X-01: Mobile-built requests, backend validation/service, and Mobile response validation agree", async () => {
  const mobile = await import(mobileValidatorsUrl) as MobileValidatorModule;
  const forms = [
    {
      ...commonForm,
      kind: "SAVINGS_PLAN" as const,
      targetAmountMinor: "12.000.000",
      alreadySavedMinor: "2.000.000",
      months: "5",
      monthlySavingsTargetMinor: "",
    },
    {
      ...commonForm,
      kind: "BUDGET_BALANCE" as const,
      targetAmountMinor: "",
      alreadySavedMinor: "",
      months: "",
      monthlySavingsTargetMinor: "2.000.000",
    },
  ];

  for (const form of forms) {
    const built = mobile.validateFinancialAdviceForm(form);
    assert.equal(built.isValid, true);
    assert.ok(built.request);
    const request = validateFinancialAdviceRequest(built.request);
    assert.equal(request.schemaVersion, "1");
    assert.equal(request.currency, "VND");
    assert.equal(request.inputConfirmed, true);

    const rulesService = new FinancialAdviceService(resolveAssistantConfig({ enabled: false }));
    const rulesResponse = await rulesService.executeAdviceRequest(request);
    assert.equal(mobile.isFinancialAdviceResponse(rulesResponse), true);

    const selection = request.kind === "SAVINGS_PLAN"
      ? { preferredOptionId: request.goal.alreadySavedMinor === request.goal.targetAmountMinor ? "GOAL_ALREADY_FUNDED" : "REDUCE_FLEXIBLE_SPENDING", reasonIds: [request.goal.alreadySavedMinor === request.goal.targetAmountMinor ? "TARGET_ALREADY_FUNDED" : "MONTHLY_GAP"] }
      : { preferredOptionId: "REDUCE_FLEXIBLE_SPENDING", reasonIds: ["MONTHLY_GAP"] };
    const provider = new FakeAssistantHelpProvider({ defaultAnswer: JSON.stringify(selection) });
    const aiService = new FinancialAdviceService(resolveAssistantConfig({ enabled: true, provider }));
    const aiResponse = await aiService.executeAdviceRequest(request);
    assert.equal(mobile.isFinancialAdviceResponse(aiResponse), true);
  }

  const invalidMobileForm = mobile.validateFinancialAdviceForm({
    ...forms[0],
    monthlyIncomeMinor: "1.5",
  });
  assert.equal(invalidMobileForm.isValid, false);
});
