import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { getControlPolicyController } from "../controllers/mobileController.js";
import type { RequireBearerFn } from "../middlewares/authMiddleware.js";

/**
 * Handles Mobile-specific endpoints (Router / URL Dispatcher):
 * - GET /api/v1/mobile/control-policy
 */
export async function handleMobileRoute(
  request: IncomingMessage,
  response: ServerResponse,
  segments: readonly string[],
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
  requireBearer: RequireBearerFn,
): Promise<boolean> {
  if (
    request.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "mobile" &&
    segments[1] === "control-policy"
  ) {
    await getControlPolicyController(request, response, system, options, traceId, requireBearer);
    return true;
  }
  return false;
}
