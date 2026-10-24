import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpOptions } from "../http.js";
import {
  getKycApplicationController,
  saveKycDraftController,
  submitKycApplicationController,
} from "../controllers/kycController.js";

/**
 * Handles KYC (Know Your Customer / Identity verification) routes (Router / URL Dispatcher):
 * - GET /api/v1/kyc/application: Get current KYC application state
 * - POST /api/v1/kyc/application: Save draft KYC application
 * - POST /api/v1/kyc/application/submit: Submit KYC application for approval
 */
export async function handleKycRoute(
  request: IncomingMessage,
  response: ServerResponse,
  segments: readonly string[],
  body: unknown,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  traceId: string,
): Promise<boolean> {
  if (segments[0] !== "kyc") {
    return false;
  }

  if (relationalRoute && options.relationalHttp) {
    // GET /kyc/application
    if (
      request.method === "GET" &&
      segments.length === 2 &&
      segments[0] === "kyc" &&
      segments[1] === "application"
    ) {
      await getKycApplicationController(response, userId, options, traceId);
      return true;
    }

    // POST /kyc/application
    if (
      request.method === "POST" &&
      segments.length === 2 &&
      segments[0] === "kyc" &&
      segments[1] === "application"
    ) {
      await saveKycDraftController(response, userId, body, options, traceId);
      return true;
    }

    // POST /kyc/application/submit
    if (
      request.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "kyc" &&
      segments[1] === "application" &&
      segments[2] === "submit"
    ) {
      await submitKycApplicationController(response, userId, body, options, traceId);
      return true;
    }
  }

  return false;
}
