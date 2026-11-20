import type { ServerResponse } from "node:http";

import type { BankingSystem } from "../bankingSystem.js";
import type { HttpOptions } from "../http.js";
import { requireObject, writeResponse } from "../routes/httpUtils.js";

/**
 * Anomaly Controller (Tầng Controller - Xử lý Request/Response cho Cảnh báo giao dịch bất thường)
 */

export async function listAnomaliesController(
  response: ServerResponse,
  userId: string,
  status: string | undefined,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const items = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.listAnomalies(userId, status)
    : system.listTransactionAnomalies(userId, status);
  writeResponse(response, 200, traceId, { items });
}

export async function getAnomalyController(
  response: ServerResponse,
  userId: string,
  anomalyId: string,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const anomaly = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.getAnomaly(userId, anomalyId)
    : system.getTransactionAnomaly(userId, anomalyId);
  writeResponse(response, 200, traceId, { anomaly });
}

export async function acknowledgeAnomalyController(
  response: ServerResponse,
  userId: string,
  anomalyId: string,
  body: unknown,
  relationalRoute: boolean,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<void> {
  const data = requireObject(body);
  const anomaly = relationalRoute && options.relationalHttp
    ? await options.relationalHttp.acknowledgeAnomaly({
        customerId: userId,
        anomalyId,
        decision: data.decision,
        note: data.note,
        traceId,
      })
    : system.acknowledgeTransactionAnomaly(userId, anomalyId, {
        decision: data.decision,
        note: data.note,
      });
  writeResponse(response, 200, traceId, { anomaly });
}
