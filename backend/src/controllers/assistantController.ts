import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { DomainError } from "../errors.js";
import { header, requireDeviceId, writeResponse, writeError } from "../routes/httpUtils.js";
import {
  AssistantHelpService,
  resolveAssistantConfig,
  type AssistantConfig,
  AssistantRateLimiter,
  readAssistantBody,
  parseAndValidateAssistantPayload,
  scanSensitiveData,
} from "../assistant/index.js";
import {
  FinancialAdviceService,
  ProviderBudgetExhaustedError,
  resolveFinancialAdviceConfig,
  validateFinancialAdviceRequest,
  readFinancialAdviceBody,
} from "../financialAdvice/index.js";
import type { RequireBearerFn } from "../routes/authRoutes.js";

const defaultAssistantRateLimiter = new AssistantRateLimiter(resolveAssistantConfig());
const assistantRateLimitersByOptions = new WeakMap<HttpOptions, AssistantRateLimiter>();

export function assistantRateLimiterFor(options: HttpOptions, config: AssistantConfig): AssistantRateLimiter {
  if (options.assistantRateLimiter) return options.assistantRateLimiter;
  if (!options.assistantConfig) return defaultAssistantRateLimiter;
  const existing = assistantRateLimitersByOptions.get(options);
  if (existing) return existing;
  const created = new AssistantRateLimiter(config);
  assistantRateLimitersByOptions.set(options, created);
  return created;
}

/**
 * Controller for POST /api/v1/assistant/help (AI-powered help chatbot)
 */
export async function handleAssistantHelpController(
  request: IncomingMessage,
  response: ServerResponse,
  system: BankingSystem,
  options: HttpOptions,
  traceId: string,
  requireBearer: RequireBearerFn,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  const config = resolveAssistantConfig(options.assistantConfig);
  if (!config.enabled) {
    throw new DomainError(503, "ASSISTANT_UNAVAILABLE", "Assistant help service is currently unavailable.");
  }

  const rawContentType = header(request, "content-type");
  if (!rawContentType) {
    throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const [mediaType] = rawContentType.split(";").map((s) => s.trim().toLowerCase());
  if (mediaType !== "application/json") {
    throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }

  const requestAbortController = new AbortController();
  let requestTimedOut = false;
  const requestDeadlineTimer = setTimeout(() => {
    requestTimedOut = true;
    requestAbortController.abort();
  }, config.requestTimeoutMs);
  requestDeadlineTimer.unref();

  const onClientPrematureClose = () => {
    if (!response.writableEnded && !response.writableFinished) {
      requestAbortController.abort();
    }
  };
  response.once("close", onClientPrematureClose);
  if (request.socket) {
    request.socket.once("close", onClientPrematureClose);
  }

  const bodyPromise = readAssistantBody(request, config.maxBodyBytes, requestAbortController.signal);
  bodyPromise.catch(() => {});

  try {
    const authPromise = requireBearer(request, system, options, options.relationalHttp);
    authPromise.catch(() => {});

    let onAuthAbort: (() => void) | undefined;
    const deadlineRejection = new Promise<never>((_, reject) => {
      if (requestAbortController.signal.aborted) {
        reject(new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out."));
        return;
      }
      onAuthAbort = () => reject(new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out."));
      requestAbortController.signal.addEventListener("abort", onAuthAbort, { once: true });
    });

    let userId: string;
    try {
      userId = await Promise.race([authPromise, deadlineRejection]);
    } finally {
      if (onAuthAbort) {
        requestAbortController.signal.removeEventListener("abort", onAuthAbort);
      }
    }
    const rawBody = await bodyPromise;
    const validated = parseAndValidateAssistantPayload(rawBody, config.maxQuestionCodePoints);

    if (scanSensitiveData(validated.question)) {
      throw new DomainError(422, "ASSISTANT_SENSITIVE_INPUT", "Request contains sensitive information; please remove credentials or secrets before asking.");
    }

    const rateLimiter = assistantRateLimiterFor(options, config);
    const releaseSlot = rateLimiter.acquire(userId);

    try {
      if (requestTimedOut || requestAbortController.signal.aborted) {
        throw new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out.");
      }

      const service = options.assistantService ?? new AssistantHelpService(config);
      const answer = await service.executeHelpRequest(
        validated.question,
        requestAbortController.signal,
        () => rateLimiter.consumeProviderCall(),
      );

      if (requestTimedOut || requestAbortController.signal.aborted) {
        throw new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out.");
      }

      if (response.writableEnded || response.destroyed) {
        return;
      }

      response.setHeader("Cache-Control", "no-store");
      writeResponse(response, 200, traceId, { answer });
    } finally {
      releaseSlot();
    }
  } catch (error: unknown) {
    if (!request.readableEnded) {
      request.resume();
    }
    if (response.writableEnded || response.destroyed) {
      return;
    }
    if (requestTimedOut) {
      writeError(response, 504, traceId, new DomainError(504, "ASSISTANT_TIMEOUT", "Assistant service request timed out."));
      return;
    }
    if (error instanceof DomainError) {
      writeError(response, error.status, traceId, error);
      return;
    }
    writeError(response, 500, traceId, new DomainError(500, "INTERNAL_ERROR", "Internal server error."));
  } finally {
    clearTimeout(requestDeadlineTimer);
    response.removeListener("close", onClientPrematureClose);
    if (request.socket) {
      request.socket.removeListener("close", onClientPrematureClose);
    }
  }
}

/**
 * Controller for POST /api/v1/assistant/financial-advice (Financial advice calculation & advice prompt)
 */
export async function handleFinancialAdviceController(
  request: IncomingMessage,
  response: ServerResponse,
  system: BankingSystem,
  options: HttpOptions,
  traceId: string,
  requireBearer: RequireBearerFn,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  const adviceConfig = resolveFinancialAdviceConfig(process.env, options.financialAdviceConfig);
  if (!adviceConfig.enabled) {
    throw new DomainError(503, "FINANCIAL_ADVICE_UNAVAILABLE", "Financial advice service is currently unavailable.");
  }

  const rawContentType = header(request, "content-type");
  if (!rawContentType) {
    throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const [mediaType] = rawContentType.split(";").map((s) => s.trim().toLowerCase());
  if (mediaType !== "application/json") {
    throw new DomainError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }

  const assistantConfig = resolveAssistantConfig(options.assistantConfig);
  const requestAbortController = new AbortController();
  let requestTimedOut = false;
  let requestDisconnected = false;
  let rejectRequestTermination!: (error: DomainError) => void;
  const requestTermination = new Promise<never>((_resolve, reject) => {
    rejectRequestTermination = reject;
  });
  const terminateRequest = (reason: "timeout" | "disconnect") => {
    if (requestAbortController.signal.aborted) return;
    requestTimedOut = reason === "timeout";
    requestDisconnected = reason === "disconnect";
    rejectRequestTermination(
      new DomainError(504, "FINANCIAL_ADVICE_TIMEOUT", "Financial advice service request timed out."),
    );
    requestAbortController.abort();
  };
  const requestDeadlineTimer = setTimeout(() => {
    terminateRequest("timeout");
  }, assistantConfig.requestTimeoutMs);
  requestDeadlineTimer.unref();

  const onClientPrematureClose = () => {
    if (!response.writableEnded && !response.writableFinished) {
      terminateRequest("disconnect");
    }
  };
  response.once("close", onClientPrematureClose);
  if (request.socket) {
    request.socket.once("close", onClientPrematureClose);
  }

  const bodyPromise = readFinancialAdviceBody(request, adviceConfig.maxBodyBytes, requestAbortController.signal);
  bodyPromise.catch(() => {});

  try {
    const authPromise = requireBearer(request, system, options, options.relationalHttp);
    authPromise.catch(() => {});

    let userId: string;
    userId = await Promise.race([authPromise, requestTermination]);

    requireDeviceId(request);

    const rawBody = await bodyPromise;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      throw new DomainError(422, "VALIDATION_ERROR", "Request body must be valid JSON.", {
        body: "Invalid JSON format.",
      });
    }

    const validatedRequest = validateFinancialAdviceRequest(parsedJson);

    const rateLimiter = assistantRateLimiterFor(options, assistantConfig);
    const releaseSlot = rateLimiter.acquire(userId);

    try {
      if (requestTimedOut || requestAbortController.signal.aborted) {
        throw new DomainError(504, "FINANCIAL_ADVICE_TIMEOUT", "Financial advice service request timed out.");
      }

      const service = options.financialAdviceService ?? new FinancialAdviceService(assistantConfig);
      const servicePromise = Promise.resolve().then(() => service.executeAdviceRequest(
        validatedRequest,
        requestAbortController.signal,
        () => {
          if (requestTimedOut || requestDisconnected || requestAbortController.signal.aborted) {
            throw new DomainError(504, "FINANCIAL_ADVICE_TIMEOUT", "Financial advice service request timed out.");
          }
          try {
            rateLimiter.consumeProviderCall();
          } catch (error) {
            if (error instanceof DomainError && error.status === 503 && error.code === "ASSISTANT_UNAVAILABLE") {
              throw new ProviderBudgetExhaustedError();
            }
            throw error;
          }
        },
      ));
      const adviceResponse = await Promise.race([servicePromise, requestTermination]);

      if (requestTimedOut || requestAbortController.signal.aborted) {
        throw new DomainError(504, "FINANCIAL_ADVICE_TIMEOUT", "Financial advice service request timed out.");
      }

      if (response.writableEnded || response.destroyed) {
        return;
      }

      writeResponse(response, 200, traceId, adviceResponse);
    } finally {
      releaseSlot();
    }
  } catch (error: unknown) {
    if (!request.readableEnded) {
      request.resume();
    }
    if (requestDisconnected || response.writableEnded || response.destroyed) {
      return;
    }
    if (requestTimedOut) {
      writeError(response, 504, traceId, new DomainError(504, "FINANCIAL_ADVICE_TIMEOUT", "Financial advice service request timed out."));
      return;
    }
    if (error instanceof DomainError) {
      writeError(response, error.status, traceId, error);
      return;
    }
    writeError(response, 500, traceId, new DomainError(500, "INTERNAL_ERROR", "Internal server error."));
  } finally {
    clearTimeout(requestDeadlineTimer);
    response.removeListener("close", onClientPrematureClose);
    if (request.socket) {
      request.socket.removeListener("close", onClientPrematureClose);
    }
  }
}
