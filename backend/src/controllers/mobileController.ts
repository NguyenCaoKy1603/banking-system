import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { writeResponse } from "../routes/httpUtils.js";
import type { RequireBearerFn } from "../middlewares/authMiddleware.js";

/**
 * Controller for Mobile feature controls and policies:
 * - GET /api/v1/mobile/control-policy
 */
export async function getControlPolicyController(
  request: IncomingMessage,
  response: ServerResponse,
  system: BankingSystem,
  options: HttpOptions,
  traceId: string,
  requireBearer: RequireBearerFn,
): Promise<void> {
  const directPolicyRoute = options.relationalHttp?.isRouteEnabled(request.method, ["mobile", "control-policy"]) ?? false;
  const userId = await requireBearer(request, system, options, directPolicyRoute ? options.relationalHttp : undefined);
  const controlPolicy = directPolicyRoute && options.relationalHttp
    ? await options.relationalHttp.getControlPolicy()
    : system.getControlPolicy(userId);
  writeResponse(response, 200, traceId, controlPolicy);
}
