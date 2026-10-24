import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { notFound } from "../errors.js";
import type { RequireBearerFn } from "./authRoutes.js";
import {
  handleAssistantHelpController,
  handleFinancialAdviceController,
} from "../controllers/assistantController.js";

/**
 * Handles Assistant and Financial Advice routes (Router / URL Dispatcher):
 * - POST /api/v1/assistant/help
 * - POST /api/v1/assistant/financial-advice
 */
export async function handleAssistantRoute(
  request: IncomingMessage,
  response: ServerResponse,
  system: BankingSystem,
  options: HttpOptions,
  segments: readonly string[],
  traceId: string,
  requireBearer: RequireBearerFn,
): Promise<void> {
  if (request.method !== "POST" || segments.length !== 2) {
    throw notFound("API route not found.");
  }

  if (segments[1] === "help") {
    await handleAssistantHelpController(request, response, system, options, traceId, requireBearer);
    return;
  }

  if (segments[1] === "financial-advice") {
    await handleFinancialAdviceController(request, response, system, options, traceId, requireBearer);
    return;
  }

  throw notFound("API route not found.");
}
