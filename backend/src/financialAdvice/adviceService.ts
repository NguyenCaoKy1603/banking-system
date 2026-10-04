import type { AssistantConfig } from "../assistant/helpConfig.js";
import type { AssistantHelpOutput } from "../assistant/helpProvider.js";
import {
  CALCULATION_VERSION,
  CATALOG_VERSION,
  buildAssumptions,
  renderBudgetParagraphs,
  renderSavingsParagraphs,
} from "./explanationCatalog.js";
import { calculateBudgetBalance, calculateSavingsPlan } from "./calculations.js";
import {
  generateBudgetOptions,
  generateBudgetWarnings,
  generateSavingsOptions,
  generateSavingsWarnings,
} from "./options.js";
import {
  buildSelectionPolicy,
  isSelectionAllowed,
  selectFallbackOption,
  selectFallbackReasons,
  type SelectionPolicy,
  type SelectionPolicyFacts,
} from "./selectionPolicy.js";
import { ADVISOR_SYSTEM_PROMPT, buildAdvisorContext } from "./advisorPrompt.js";
import { InvalidSelectorOutputError, parseStrictAIOutput } from "./selectorValidation.js";
import type {
  FallbackReason,
  FinancialAdviceBudgetResponse,
  FinancialAdviceOption,
  FinancialAdviceRequest,
  FinancialAdviceResponse,
  FinancialAdviceSavingsResponse,
  FinancialOptionId,
  ReasonId,
} from "./types.js";

export class ProviderBudgetExhaustedError extends Error {
  constructor() {
    super("Financial advice provider-call budget exhausted.");
    this.name = "ProviderBudgetExhaustedError";
  }
}

function createAbortError(): Error {
  const error = new Error("Financial advice request was cancelled.");
  error.name = "AbortError";
  return error;
}

type SelectionResult = {
  mode: "AI_ASSISTED" | "RULE_BASED";
  preferredOptionId: FinancialOptionId;
  reasonIds: ReasonId[];
  fallbackReason: FallbackReason | null;
};

type ProviderOutcome =
  | { type: "output"; output: AssistantHelpOutput }
  | { type: "error" }
  | { type: "timeout" }
  | { type: "abort" };

function buildFallbackSelection(
  policy: SelectionPolicy,
  request: FinancialAdviceRequest,
  fallbackReason: FallbackReason,
): SelectionResult {
  const preferredOptionId = selectFallbackOption(policy, request.preference, request.kind);
  const reasonIds = selectFallbackReasons(policy, preferredOptionId);
  if (!isSelectionAllowed(policy, preferredOptionId, reasonIds)) {
    throw new Error("Financial advice fallback violated the selection policy.");
  }
  return { mode: "RULE_BASED", preferredOptionId, reasonIds, fallbackReason };
}

export class FinancialAdviceService {
  constructor(private readonly config: AssistantConfig) {}

  async executeAdviceRequest(
    request: FinancialAdviceRequest,
    clientSignal?: AbortSignal,
    consumeProviderCall?: () => void,
  ): Promise<FinancialAdviceResponse> {
    if (request.kind === "SAVINGS_PLAN") return this.handleSavingsPlan(request, clientSignal, consumeProviderCall);
    return this.handleBudgetBalance(request, clientSignal, consumeProviderCall);
  }

  private async callProviderWithFallback(
    request: FinancialAdviceRequest,
    facts: Record<string, unknown>,
    options: FinancialAdviceOption[],
    policyFacts: SelectionPolicyFacts,
    clientSignal?: AbortSignal,
    consumeProviderCall?: () => void,
  ): Promise<SelectionResult> {
    if (clientSignal?.aborted) throw createAbortError();
    const policy = buildSelectionPolicy(request, options, policyFacts);
    if (!policy.eligiblePreferredOptionIds.length) throw new Error("Financial advice selection policy has no eligible option.");

    if (!this.config.enabled || !this.config.provider) {
      return buildFallbackSelection(policy, request, "AI_DISABLED");
    }

    if (consumeProviderCall) {
      try {
        consumeProviderCall();
      } catch (error) {
        if (error instanceof ProviderBudgetExhaustedError) {
          return buildFallbackSelection(policy, request, "PROVIDER_BUDGET_EXHAUSTED");
        }
        throw error;
      }
    }
    if (clientSignal?.aborted) throw createAbortError();

    const context = buildAdvisorContext({ kind: request.kind, preference: request.preference, facts, options, policy });
    const providerAbortController = new AbortController();
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let onClientAbort: (() => void) | undefined;
    const providerResult: Promise<ProviderOutcome> = Promise.resolve()
      .then(() => this.config.provider!.generateHelpResponse(
        ADVISOR_SYSTEM_PROMPT,
        context,
        "Hãy chọn preferredOptionId và reasonIds phù hợp với dữ liệu trên.",
        providerAbortController.signal,
      ))
      .then<ProviderOutcome, ProviderOutcome>(
        (output) => ({ type: "output", output }),
        () => ({ type: "error" }),
      );
    const timeoutResult = new Promise<ProviderOutcome>((resolve) => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        providerAbortController.abort();
        resolve({ type: "timeout" });
      }, this.config.providerTimeoutMs);
    });
    let abortResult: Promise<ProviderOutcome> | undefined;
    if (clientSignal) {
      abortResult = new Promise((resolve) => {
        onClientAbort = () => {
          providerAbortController.abort();
          resolve({ type: "abort" });
        };
        clientSignal.addEventListener("abort", onClientAbort, { once: true });
        if (clientSignal.aborted) onClientAbort();
      });
    }

    try {
      const settled = await Promise.race<ProviderOutcome>(
        abortResult ? [providerResult, timeoutResult, abortResult] : [providerResult, timeoutResult],
      );
      if (settled.type === "abort" || clientSignal?.aborted) throw createAbortError();
      if (settled.type === "timeout") return buildFallbackSelection(policy, request, "PROVIDER_TIMEOUT");
      if (settled.type === "error") return buildFallbackSelection(policy, request, "PROVIDER_UNAVAILABLE");
      if (settled.output.finishReason !== "stop" || settled.output.toolCallsDetected) {
        throw new InvalidSelectorOutputError();
      }
      const selected = parseStrictAIOutput(settled.output.text, policy);
      return {
        mode: "AI_ASSISTED",
        preferredOptionId: selected.preferredOptionId,
        reasonIds: selected.reasonIds,
        fallbackReason: null,
      };
    } catch (error) {
      if (clientSignal?.aborted || (error instanceof Error && error.name === "AbortError")) throw createAbortError();
      if (error instanceof InvalidSelectorOutputError) {
        return buildFallbackSelection(policy, request, "PROVIDER_INVALID_OUTPUT");
      }
      return buildFallbackSelection(policy, request, timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE");
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (clientSignal && onClientAbort) clientSignal.removeEventListener("abort", onClientAbort);
    }
  }

  private async handleSavingsPlan(
    request: FinancialAdviceRequest & { kind: "SAVINGS_PLAN" },
    clientSignal?: AbortSignal,
    consumeProviderCall?: () => void,
  ): Promise<FinancialAdviceSavingsResponse> {
    const calc = calculateSavingsPlan(request);
    const options = generateSavingsOptions(calc);
    const warnings = generateSavingsWarnings(calc);
    const selection = await this.callProviderWithFallback(request, calc.metrics, options, {
      alreadyFunded: calc.goalStatus === "ALREADY_FUNDED",
      isFeasible: calc.goalStatus === "FEASIBLE",
      isBudgetMet: false,
      hasMonthlyGap: calc.goalStatus === "GAP",
      baseDeficit: calc.budgetStatus === "DEFICIT",
      bufferShortfall: calc.raw.bufferShortfall > 0n,
      noCapacity: calc.raw.C <= 0n,
    }, clientSignal, consumeProviderCall);
    const paragraphs = renderSavingsParagraphs(calc, selection.preferredOptionId, selection.reasonIds, request.preference);
    return {
      schemaVersion: "1",
      kind: "SAVINGS_PLAN",
      currency: "VND",
      source: "USER_ENTERED",
      calculationVersion: CALCULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      budgetStatus: calc.budgetStatus,
      goalStatus: calc.goalStatus,
      metrics: calc.metrics,
      options,
      preferredOptionId: selection.preferredOptionId as FinancialAdviceSavingsResponse["preferredOptionId"],
      explanation: { mode: selection.mode, reasonIds: selection.reasonIds, paragraphs, fallbackReason: selection.fallbackReason },
      assumptions: buildAssumptions(selection.fallbackReason),
      warnings,
    };
  }

  private async handleBudgetBalance(
    request: FinancialAdviceRequest & { kind: "BUDGET_BALANCE" },
    clientSignal?: AbortSignal,
    consumeProviderCall?: () => void,
  ): Promise<FinancialAdviceBudgetResponse> {
    const calc = calculateBudgetBalance(request);
    const options = generateBudgetOptions(calc);
    const warnings = generateBudgetWarnings(calc);
    const selection = await this.callProviderWithFallback(request, calc.metrics, options, {
      alreadyFunded: false,
      isFeasible: false,
      isBudgetMet: calc.savingsTargetStatus === "MET",
      hasMonthlyGap: calc.savingsTargetStatus === "GAP",
      baseDeficit: calc.budgetStatus === "DEFICIT",
      bufferShortfall: calc.raw.bufferShortfall > 0n,
      noCapacity: calc.raw.C <= 0n,
    }, clientSignal, consumeProviderCall);
    const paragraphs = renderBudgetParagraphs(calc, selection.preferredOptionId, selection.reasonIds, request.preference);
    return {
      schemaVersion: "1",
      kind: "BUDGET_BALANCE",
      currency: "VND",
      source: "USER_ENTERED",
      calculationVersion: CALCULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      budgetStatus: calc.budgetStatus,
      savingsTargetStatus: calc.savingsTargetStatus,
      metrics: calc.metrics,
      options,
      preferredOptionId: selection.preferredOptionId as FinancialAdviceBudgetResponse["preferredOptionId"],
      explanation: { mode: selection.mode, reasonIds: selection.reasonIds, paragraphs, fallbackReason: selection.fallbackReason },
      assumptions: buildAssumptions(selection.fallbackReason),
      warnings,
    };
  }
}
