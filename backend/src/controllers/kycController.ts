import type { ServerResponse } from "node:http";
import type { HttpOptions } from "../http.js";
import { requireObject, writeResponse } from "../routes/httpUtils.js";

/**
 * KYC Controller (Tầng Controller - Xử lý Request/Response cho Định danh điện tử eKYC)
 */

export async function getKycApplicationController(
  response: ServerResponse,
  userId: string,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  if (!options.relationalHttp) return;
  writeResponse(response, 200, traceId, {
    application: await options.relationalHttp.getKycApplication(userId),
  });
}

export async function saveKycDraftController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  if (!options.relationalHttp) return;
  const data = requireObject(body);
  writeResponse(response, 200, traceId, {
    application: await options.relationalHttp.saveKycDraft(userId, data as never),
  });
}

export async function submitKycApplicationController(
  response: ServerResponse,
  userId: string,
  body: unknown,
  options: HttpOptions,
  traceId: string,
): Promise<void> {
  if (!options.relationalHttp) return;
  const data = requireObject(body);
  writeResponse(response, 201, traceId, {
    application: await options.relationalHttp.submitKycApplication(userId, data as never),
  });
}
