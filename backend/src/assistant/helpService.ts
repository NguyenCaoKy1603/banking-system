import { DomainError } from "../errors.js";
import type { AssistantConfig } from "./helpConfig.js";
import type { AssistantHelpOutput } from "./helpProvider.js";
import { scanSensitiveData } from "./sensitiveDataFilter.js";
import {
  ANSWER_CATALOG_HASH,
  ANSWER_CATALOG_VERSION,
  ASSISTANT_SELECTOR_CONTEXT,
  ASSISTANT_SELECTOR_PROMPT,
  ASSISTANT_SELECTOR_PROMPT_HASH,
  getAnswerCatalogEntry,
  type AnswerSelectionId,
  validateAnswerCatalog,
} from "./responseCatalog.js";
import { loadKnowledge } from "./knowledgeLoader.js";
import { resolveDeterministicSelection } from "./selectionPolicy.js";

export type AssistantHelpDecision = {
  answer: string;
  selectionId: AnswerSelectionId;
  resolution: "deterministic" | "model-selected";
  path: "deterministic" | "model-selected" | "clarification" | "out-of-scope";
  modelCalled: boolean;
  catalogVersion: string;
  catalogHash: string;
  selectorPromptHash: string;
};

function providerError(message: string): DomainError {
  return new DomainError(502, "ASSISTANT_PROVIDER_ERROR", message);
}

function parseSelectionId(text: string): AnswerSelectionId {
  // Accept only the one-field JSON shape; this also rejects duplicate keys,
  // markdown fences, free text and escaped/unexpected field names.
  const match = /^\{\s*"selectionId"\s*:\s*"([A-Z0-9_-]+)"\s*\}$/.exec(text);
  if (!match) {
    throw providerError("Assistant provider returned an invalid selection response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw providerError("Assistant provider returned an invalid selection response.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw providerError("Assistant provider returned an invalid selection response.");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.selectionId !== "string" || record.selectionId !== match[1]) {
    throw providerError("Assistant provider returned an invalid selection response.");
  }
  const entry = getAnswerCatalogEntry(record.selectionId);
  if (!entry) {
    throw providerError("Assistant provider selected an unknown guide.");
  }
  return entry.id;
}

function responsePath(selectionId: AnswerSelectionId, resolution: AssistantHelpDecision["resolution"]): AssistantHelpDecision["path"] {
  if (resolution === "deterministic") return "deterministic";
  if (selectionId === "CLARIFY") return "clarification";
  if (selectionId === "OUT_OF_SCOPE") return "out-of-scope";
  return "model-selected";
}

function createDecision(
  selectionId: AnswerSelectionId,
  resolution: AssistantHelpDecision["resolution"],
  maxAnswerCodePoints: number,
): AssistantHelpDecision {
  const entry = getAnswerCatalogEntry(selectionId);
  if (!entry) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant answer catalog is unavailable.");
  }
  const answerCodePoints = Array.from(entry.answer).length;
  if (!entry.answer.trim() || answerCodePoints > maxAnswerCodePoints) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant answer catalog entry is invalid.");
  }
  return {
    answer: entry.answer,
    selectionId,
    resolution,
    path: responsePath(selectionId, resolution),
    modelCalled: resolution === "model-selected",
    catalogVersion: ANSWER_CATALOG_VERSION,
    catalogHash: ANSWER_CATALOG_HASH,
    selectorPromptHash: ASSISTANT_SELECTOR_PROMPT_HASH,
  };
}

export class AssistantHelpService {
  constructor(private readonly config: AssistantConfig) {}

  /** Public API adapter: the response remains a plain catalog-backed answer. */
  async executeHelpRequest(
    question: string,
    requestSignal?: AbortSignal,
    beforeProviderCall?: () => void,
  ): Promise<string> {
    const decision = await this.executeHelpDecision(question, requestSignal, beforeProviderCall);
    return decision.answer;
  }

  /** Internal evidence seam used by tests/evaluation; HTTP exposes only `answer`. */
  async executeHelpDecision(
    question: string,
    requestSignal?: AbortSignal,
    beforeProviderCall?: () => void,
  ): Promise<AssistantHelpDecision> {
    if (!this.config.enabled) {
      throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant help service is currently disabled.");
    }
    if (requestSignal?.aborted) {
      const err = new Error("Request already aborted.");
      err.name = "AbortError";
      throw err;
    }

    const knowledge = loadKnowledge();
    try {
      validateAnswerCatalog(knowledge.faqItemIds);
    } catch {
      throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant answer catalog does not match the verified FAQ source.");
    }

    if (scanSensitiveData(question)) {
      throw new DomainError(422, "ASSISTANT_SENSITIVE_INPUT", "Request contains sensitive information; please remove credentials or secrets before asking.");
    }

    const deterministic = resolveDeterministicSelection(question);
    if (deterministic) {
      return createDecision(deterministic.selectionId, "deterministic", this.config.maxAnswerCodePoints);
    }

    const provider = this.config.provider;
    if (!provider) {
      throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant help provider is not configured.");
    }

    const providerAbortController = new AbortController();
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      providerAbortController.abort();
    }, this.config.providerTimeoutMs);

    const onRequestAbort = () => providerAbortController.abort();
    requestSignal?.addEventListener("abort", onRequestAbort);

    try {
      let abortListener: (() => void) | undefined;
      const abortPromise = new Promise<never>((_, reject) => {
        if (providerAbortController.signal.aborted) {
          reject(timedOut
            ? new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant provider request timed out.")
            : Object.assign(new Error("Request aborted by client or request deadline."), { name: "AbortError" }));
          return;
        }
        abortListener = () => reject(timedOut
          ? new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant provider request timed out.")
          : Object.assign(new Error("Request aborted by client or request deadline."), { name: "AbortError" }));
        providerAbortController.signal.addEventListener("abort", abortListener, { once: true });
      });

      let output: AssistantHelpOutput;
      try {
        beforeProviderCall?.();
        output = await Promise.race([
          provider.generateHelpResponse(
            ASSISTANT_SELECTOR_PROMPT,
            ASSISTANT_SELECTOR_CONTEXT,
            question,
            providerAbortController.signal,
          ),
          abortPromise,
        ]);
      } finally {
        if (abortListener) providerAbortController.signal.removeEventListener("abort", abortListener);
      }

      if (timedOut) throw new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant provider request timed out.");
      if (requestSignal?.aborted || providerAbortController.signal.aborted) {
        const err = new Error("Request aborted by client or request deadline.");
        err.name = "AbortError";
        throw err;
      }
      if (!output || typeof output !== "object" || typeof output.text !== "string") {
        throw providerError("Assistant provider output is malformed.");
      }
      const rawOutput = output as Record<string, unknown>;
      if (output.toolCallsDetected || Boolean(rawOutput.toolCalls) || Boolean(rawOutput.tool_calls) || output.finishReason === "tool_calls") {
        throw providerError("Assistant provider attempted an unauthorized tool call.");
      }
      if (output.finishReason !== "stop") {
        throw providerError("Assistant provider finished with an unacceptable completion reason.");
      }

      const selectionText = output.text.trim();
      if (!selectionText) throw providerError("Assistant provider returned an empty response.");
      if (Array.from(selectionText).length > this.config.maxAnswerCodePoints) {
        throw providerError("Assistant provider output exceeded maximum length limit.");
      }

      const selectionId = parseSelectionId(selectionText);
      return createDecision(selectionId, "model-selected", this.config.maxAnswerCodePoints);
    } catch (error: unknown) {
      if (timedOut) {
        throw new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant provider request timed out.");
      }
      if (requestSignal?.aborted) {
        const err = new Error("Request aborted by client or request deadline.");
        err.name = "AbortError";
        throw err;
      }
      if (error instanceof DomainError) throw error;
      // Never forward provider output or exception details to the public boundary.
      throw new DomainError(502, "ASSISTANT_PROVIDER_ERROR", "Assistant service failed to generate a response.");
    } finally {
      clearTimeout(timeoutTimer);
      requestSignal?.removeEventListener("abort", onRequestAbort);
    }
  }
}
