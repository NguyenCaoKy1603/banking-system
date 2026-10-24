import { DomainError } from "../../errors.js";
import { AssistantRateLimiter, MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN } from "../../assistant/rateLimiter.js";
import { resolveAssistantConfig, type AssistantConfig } from "../../assistant/helpConfig.js";
import type { AssistantHelpOutput, AssistantHelpProvider } from "../../assistant/helpProvider.js";
import { FinancialAdviceService, ProviderBudgetExhaustedError } from "../../financialAdvice/adviceService.js";
import type { EvaluationCase } from "./dataset.js";
import {
  blockedEvaluationResult,
  evaluateFinancialAdviceCase,
  type EvaluationMode,
  type EvaluationResult,
  type PublicResponseValidator,
} from "./reporting.js";

type CapturedProviderCall = {
  output: AssistantHelpOutput | null;
  rejected: boolean;
  consumed: boolean;
};

class CapturingProvider implements AssistantHelpProvider {
  attempts = 0;
  readonly calls: CapturedProviderCall[] = [];

  constructor(private readonly inner: AssistantHelpProvider) {}

  async generateHelpResponse(
    prompt: string,
    knowledgeContext: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<AssistantHelpOutput> {
    this.attempts += 1;
    const record: CapturedProviderCall = { output: null, rejected: false, consumed: false };
    this.calls.push(record);
    try {
      const output = await this.inner.generateHelpResponse(prompt, knowledgeContext, question, signal);
      if (!record.consumed) record.output = output;
      return output;
    } catch {
      record.rejected = true;
      throw new Error("Evaluation provider call failed.");
    }
  }

  takeCall(index: number): Omit<CapturedProviderCall, "consumed"> | null {
    const record = this.calls[index];
    if (!record) return null;
    const result = { output: record.output, rejected: record.rejected };
    record.consumed = true;
    record.output = null;
    return result;
  }
}

export type EvaluationBatchRun = {
  results: EvaluationResult[];
  providerAttemptedCount: number;
  chargedProviderCallCount: number;
  activeConcurrencyAfter: number;
  activeConcurrencyByUserAfter: number[];
  providerBudget: number;
  quotaInvariant: boolean;
};

export async function runFinancialAdviceBatch(input: {
  cases: readonly EvaluationCase[];
  batchId: string;
  runId: string;
  mode: EvaluationMode;
  provider?: AssistantHelpProvider;
  validatePublicResponse: PublicResponseValidator;
  configOverrides?: Partial<AssistantConfig>;
}): Promise<EvaluationBatchRun> {
  if (input.mode === "live-service" && !input.provider) {
    return {
      results: input.cases.map((testCase) => blockedEvaluationResult(testCase, input.batchId, input.runId, "PROVIDER_OFFLINE")),
      providerAttemptedCount: 0, chargedProviderCallCount: 0,
      activeConcurrencyAfter: 0, activeConcurrencyByUserAfter: [],
      providerBudget: MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN, quotaInvariant: true,
    };
  }
  if (input.mode === "offline" && input.provider) {
    throw new Error("Offline evaluation cannot receive a live provider.");
  }

  const capturedProvider = input.provider ? new CapturingProvider(input.provider) : undefined;
  const config = resolveAssistantConfig({
    ...input.configOverrides,
    enabled: input.mode === "live-service",
    provider: capturedProvider,
  });
  const limiter = new AssistantRateLimiter({
    rateLimitPerMinute: config.rateLimitPerMinute,
    maxConcurrentRequests: config.maxConcurrentRequests,
    maxConcurrentPerUser: config.maxConcurrentPerUser,
  });
  const service = new FinancialAdviceService(config);
  const results: EvaluationResult[] = [];
  const userIds: string[] = [];

  for (let index = 0; index < input.cases.length; index += 1) {
    const testCase = input.cases[index]!;
    const userId = `financial-advice-evaluation:${input.runId}:${testCase.id}:${index}`;
    const attemptBefore = capturedProvider?.attempts ?? 0;
    const started = Date.now();
    let release: (() => void) | undefined;
    try {
      release = limiter.acquire(userId);
      userIds.push(userId);
      const response = await service.executeAdviceRequest(testCase.request, undefined, () => {
        try {
          limiter.consumeProviderCall();
        } catch (error) {
          if (error instanceof DomainError && error.code === "ASSISTANT_UNAVAILABLE") {
            throw new ProviderBudgetExhaustedError();
          }
          throw error;
        }
      });
      const providerIndex = attemptBefore;
      const captured = capturedProvider?.takeCall(providerIndex) ?? null;
      results.push(evaluateFinancialAdviceCase({
        testCase,
        batchId: input.batchId,
        runId: input.runId,
        response,
        providerAttempted: (capturedProvider?.attempts ?? 0) > attemptBefore,
        rawOutput: captured?.output ? {
          text: captured.output.text,
          finishReason: captured.output.finishReason,
          toolCallsDetected: captured.output.toolCallsDetected,
        } : null,
        latencyMs: Date.now() - started,
        validatePublicResponse: input.validatePublicResponse,
      }));
    } catch {
      const attempted = (capturedProvider?.attempts ?? 0) > attemptBefore;
      if (attempted) capturedProvider?.takeCall(attemptBefore);
      results.push(blockedEvaluationResult(testCase, input.batchId, input.runId,
        attempted ? "CASE_EXECUTION_EXCEPTION" : "CASE_EXECUTION_EXCEPTION"));
      const blocked = results[results.length - 1]!;
      blocked.executionStatus = "FAIL";
      blocked.providerAttempted = attempted;
      blocked.latencyMs = Math.max(0, Date.now() - started);
      if (attempted) {
        blocked.rawSchemaValid = false;
        blocked.semanticValid = false;
      }
    } finally {
      release?.();
    }
  }

  const providerAttemptedCount = capturedProvider?.attempts ?? 0;
  const chargedProviderCallCount = limiter.getProviderCallCount();
  const activeConcurrencyByUserAfter = userIds.map((userId) => limiter.getUserActiveConcurrency(userId));
  const quotaInvariant = providerAttemptedCount === chargedProviderCallCount &&
    providerAttemptedCount <= MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN &&
    activeConcurrencyByUserAfter.every((active) => active === 0) && limiter.getActiveConcurrency() === 0;
  return {
    results,
    providerAttemptedCount,
    chargedProviderCallCount,
    activeConcurrencyAfter: limiter.getActiveConcurrency(),
    activeConcurrencyByUserAfter,
    providerBudget: MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN,
    quotaInvariant,
  };
}
