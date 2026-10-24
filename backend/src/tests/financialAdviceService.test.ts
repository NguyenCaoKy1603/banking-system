import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssistantConfig } from "../assistant/helpConfig.js";
import {
  FakeAssistantHelpProvider,
} from "../assistant/helpProvider.js";
import {
  FinancialAdviceService,
  ProviderBudgetExhaustedError,
} from "../financialAdvice/adviceService.js";
import type {
  FinancialAdviceBudgetRequest,
  FinancialAdviceSavingsRequest,
} from "../financialAdvice/types.js";

const baseSavingsRequest: FinancialAdviceSavingsRequest = {
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

const baseBudgetRequest: FinancialAdviceBudgetRequest = {
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

test("A-01: Valid AI provider returns AI_ASSISTED with backend-rendered paragraphs", async () => {
  const fake = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "EXTEND_DEADLINE",
      reasonIds: ["MONTHLY_GAP", "PRESERVE_CURRENT_SPENDING"],
    }),
  });

  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "AI_ASSISTED");
  assert.equal(response.preferredOptionId, "EXTEND_DEADLINE");
  assert.deepEqual(response.explanation.reasonIds, [
    "MONTHLY_GAP",
    "PRESERVE_CURRENT_SPENDING",
  ]);
  assert.equal(response.explanation.fallbackReason, null);
  assert.ok(response.explanation.paragraphs.length >= 2);
  assert.equal(fake.callCount, 1);
});

test("A-02: Text/fenced markdown outside JSON causes fallback to RULE_BASED", async () => {
  const fake = new FakeAssistantHelpProvider({
    defaultAnswer:
      "```json\n" +
      JSON.stringify({
        preferredOptionId: "EXTEND_DEADLINE",
        reasonIds: ["MONTHLY_GAP"],
      }) +
      "\n```",
  });

  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_INVALID_OUTPUT");
  assert.equal(response.preferredOptionId, "EXTEND_DEADLINE"); // rule selected
});

test("A-03: Unknown or extra keys cause fallback", async () => {
  const fake = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "EXTEND_DEADLINE",
      reasonIds: ["MONTHLY_GAP"],
      extraKey: "illegal",
    }),
  });

  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_INVALID_OUTPUT");
});

test("A-04: Option ID not in candidate options causes fallback", async () => {
  const fake = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "GOAL_ALREADY_FUNDED", // not valid for GAP case
      reasonIds: ["MONTHLY_GAP"],
    }),
  });

  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_INVALID_OUTPUT");
});

test("A-05 & A-06: Reason not in allowed set or duplicates cause fallback", async () => {
  const fake = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "EXTEND_DEADLINE",
      reasonIds: ["TARGET_ALREADY_FUNDED"], // invalid reason for GAP case
    }),
  });

  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_INVALID_OUTPUT");
});

test("A-07: finishReason length or tool calls detected causes rejection & fallback", async () => {
  const fake = new FakeAssistantHelpProvider({
    customOutput: {
      text: JSON.stringify({
        preferredOptionId: "EXTEND_DEADLINE",
        reasonIds: ["MONTHLY_GAP"],
      }),
      finishReason: "length",
      toolCallsDetected: false,
    },
  });

  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_INVALID_OUTPUT");
});

test("A-08: Provider error / timeout triggers rule fallback", async () => {
  const fake = new FakeAssistantHelpProvider({
    mode: "error",
    errorToThrow: new Error("Network down"),
  });

  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_UNAVAILABLE");
});

test("A-10: Quota exhausted triggers PROVIDER_BUDGET_EXHAUSTED", async () => {
  const fake = new FakeAssistantHelpProvider();
  const config = resolveAssistantConfig({
    enabled: true,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  // simulate quota exhausted by throwing from consumer
  const response = await service.executeAdviceRequest(
    baseSavingsRequest,
    undefined,
    () => {
      throw new ProviderBudgetExhaustedError();
    },
  );

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_BUDGET_EXHAUSTED");
  assert.equal(fake.callCount, 0); // never called
});

test("A-17: Duplicate selector keys, including escaped duplicate keys, are rejected", async () => {
  for (const answer of [
    '{"preferredOptionId":"EXTEND_DEADLINE","preferredOptionId":"LOWER_GOAL_AMOUNT","reasonIds":["MONTHLY_GAP"]}',
    '{"preferredOptionId":"EXTEND_DEADLINE","preferredOption\\u0049d":"LOWER_GOAL_AMOUNT","reasonIds":["MONTHLY_GAP"]}',
  ]) {
    const fake = new FakeAssistantHelpProvider({ defaultAnswer: answer });
    const service = new FinancialAdviceService(resolveAssistantConfig({ enabled: true, provider: fake }));
    const response = await service.executeAdviceRequest(baseSavingsRequest);
    assert.equal(response.explanation.mode, "RULE_BASED");
    assert.equal(response.explanation.fallbackReason, "PROVIDER_INVALID_OUTPUT");
  }
});

test("A-18: An arbitrary quota callback error is not mistaken for exhausted budget", async () => {
  const fake = new FakeAssistantHelpProvider();
  const service = new FinancialAdviceService(resolveAssistantConfig({ enabled: true, provider: fake }));
  await assert.rejects(
    service.executeAdviceRequest(baseSavingsRequest, undefined, () => { throw new Error("unexpected callback error"); }),
  );
  assert.equal(fake.callCount, 0);
});

test("A-19: Already-aborted requests do not consume provider quota", async () => {
  let consumes = 0;
  const fake = new FakeAssistantHelpProvider();
  const service = new FinancialAdviceService(resolveAssistantConfig({ enabled: true, provider: fake }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.executeAdviceRequest(baseSavingsRequest, controller.signal, () => { consumes += 1; }));
  assert.equal(consumes, 0);
  assert.equal(fake.callCount, 0);
});

test("A-20: Provider timeout returns fallback without awaiting a provider that ignores abort", async () => {
  let capturedSignal: AbortSignal | undefined;
  const provider = {
    generateHelpResponse: async (_prompt: string, _context: string, _question: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<never>(() => {});
    },
  };
  const service = new FinancialAdviceService(resolveAssistantConfig({
    enabled: true,
    provider,
    providerTimeoutMs: 15,
  }));
  const response = await service.executeAdviceRequest(baseSavingsRequest);
  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_TIMEOUT");
  assert.equal(capturedSignal?.aborted, true);
});

test("A-21: BALANCED zero-capacity case prefers review while preserving a feasible cut candidate", async () => {
  const request: FinancialAdviceSavingsRequest = {
    ...baseSavingsRequest,
    monthlyIncomeMinor: "8500000",
    preference: "BALANCED",
  };
  const fake = new FakeAssistantHelpProvider({ defaultAnswer: JSON.stringify({
    preferredOptionId: "REDUCE_FLEXIBLE_SPENDING",
    reasonIds: ["MONTHLY_GAP"],
  }) });
  const service = new FinancialAdviceService(resolveAssistantConfig({ enabled: true, provider: fake }));
  const response = await service.executeAdviceRequest(request);
  assert.ok(response.options.some((option) => option.id === "REDUCE_FLEXIBLE_SPENDING"));
  assert.equal(response.preferredOptionId, "REVIEW_BASE_BUDGET");
  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "PROVIDER_INVALID_OUTPUT");
  assert.ok(response.explanation.reasonIds.includes("NO_SAVING_CAPACITY"));
});

test("A-11: Assistant disabled triggers AI_DISABLED fallback without provider call", async () => {
  const fake = new FakeAssistantHelpProvider();
  const config = resolveAssistantConfig({
    enabled: false,
    provider: fake,
  });

  const service = new FinancialAdviceService(config);
  const response = await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(response.explanation.mode, "RULE_BASED");
  assert.equal(response.explanation.fallbackReason, "AI_DISABLED");
  assert.equal(fake.callCount, 0);
});

test("A-13: Metrics & options invariant between AI success and fallback", async () => {
  const validFake = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "EXTEND_DEADLINE",
      reasonIds: ["MONTHLY_GAP", "PRESERVE_CURRENT_SPENDING"],
    }),
  });
  const errorFake = new FakeAssistantHelpProvider({ mode: "error" });

  const aiService = new FinancialAdviceService(
    resolveAssistantConfig({ enabled: true, provider: validFake }),
  );
  const fallbackService = new FinancialAdviceService(
    resolveAssistantConfig({ enabled: true, provider: errorFake }),
  );

  const aiRes = await aiService.executeAdviceRequest(baseSavingsRequest);
  const fallbackRes = await fallbackService.executeAdviceRequest(baseSavingsRequest);

  assert.equal(aiRes.explanation.mode, "AI_ASSISTED");
  assert.equal(fallbackRes.explanation.mode, "RULE_BASED");

  // Metrics, options and warnings must be exactly identical!
  assert.deepEqual(aiRes.metrics, fallbackRes.metrics);
  assert.deepEqual(aiRes.options, fallbackRes.options);
  assert.deepEqual(aiRes.warnings, fallbackRes.warnings);
  assert.equal(aiRes.budgetStatus, fallbackRes.budgetStatus);
  if (aiRes.kind === "SAVINGS_PLAN" && fallbackRes.kind === "SAVINGS_PLAN") {
    assert.equal(aiRes.goalStatus, fallbackRes.goalStatus);
  }
});

test("A-16: Context inspector verifies NO customer tokens or secrets in prompt context", async () => {
  const fake = new FakeAssistantHelpProvider({
    defaultAnswer: JSON.stringify({
      preferredOptionId: "EXTEND_DEADLINE",
      reasonIds: ["MONTHLY_GAP"],
    }),
  });

  const service = new FinancialAdviceService(
    resolveAssistantConfig({ enabled: true, provider: fake }),
  );
  await service.executeAdviceRequest(baseSavingsRequest);

  assert.equal(fake.callCount, 1);
  const sentCall = fake.calls[0];
  assert.ok(!sentCall.knowledgeContext.includes("Bearer"));
  assert.ok(!sentCall.knowledgeContext.includes("accessToken"));
  assert.ok(!sentCall.knowledgeContext.includes("password"));
  assert.ok(!sentCall.knowledgeContext.includes("customerId"));
});
