import type { IncomingMessage, ServerResponse } from "node:http";

import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import {
  acknowledgeAnomalyController,
  getAnomalyController,
  listAnomaliesController,
} from "../controllers/anomalyController.js";

/**
 * Handles transaction anomaly alert routes (Router / URL Dispatcher):
 * - GET  /api/v1/anomalies
 * - GET  /api/v1/anomalies/:id
 * - POST /api/v1/anomalies/:id/acknowledge
 */
export async function handleAnomalyRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  segments: readonly string[],
  body: unknown,
  userId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<boolean> {
  if (segments[0] !== "anomalies") {
    return false;
  }

  // GET /anomalies
  if (
    request.method === "GET" &&
    segments.length === 1 &&
    segments[0] === "anomalies"
  ) {
    const status = requestUrl.searchParams.get("status") ?? undefined;
    await listAnomaliesController(response, userId, status, relationalRoute, options, system, traceId);
    return true;
  }

  // GET /anomalies/:id
  if (
    request.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "anomalies"
  ) {
    await getAnomalyController(response, userId, segments[1], relationalRoute, options, system, traceId);
    return true;
  }

  // POST /anomalies/:id/acknowledge
  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[0] === "anomalies" &&
    segments[2] === "acknowledge"
  ) {
    await acknowledgeAnomalyController(response, userId, segments[1], body, relationalRoute, options, system, traceId);
    return true;
  }

  return false;
}
