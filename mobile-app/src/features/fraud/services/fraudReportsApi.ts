import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import {
  GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH,
  requireIdempotencyKey,
} from "@/features/banking/validation/idempotencyKey";
import type {
  FraudReportRequest,
  FraudReportResponse,
} from "@/features/fraud/types/fraudReport";
import { isFraudReportResponse } from "@/features/fraud/validation/fraudReportValidators";

export function submitFraudReport(
  request: FraudReportRequest,
  options: { auth: RequestAuth; idempotencyKey: string },
): Promise<FraudReportResponse> {
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(
      options.idempotencyKey,
      GENERAL_IDEMPOTENCY_KEY_MIN_LENGTH,
    );
  } catch {
    return Promise.reject(new TypeError("Fraud report fields are invalid."));
  }
  if (
    !request.accountId.trim() ||
    !request.transactionId.trim() ||
    request.reason.trim().length < 5 ||
    request.reason.length > 1_000
  ) {
    return Promise.reject(new TypeError("Fraud report fields are invalid."));
  }

  return requestJson<FraudReportResponse>(
    "/fraud-reports",
    {
      method: "POST",
      body: request,
      auth: options.auth,
      idempotencyKey,
    },
    isFraudReportResponse,
  );
}

export function getFraudReport(
  reportId: string,
  auth: RequestAuth,
): Promise<FraudReportResponse> {
  if (!reportId.trim()) {
    return Promise.reject(new TypeError("reportId is required."));
  }
  return requestJson<FraudReportResponse>(
    `/fraud-reports/${encodeURIComponent(reportId)}`,
    { auth },
    isFraudReportResponse,
  );
}

export const fraudReportsApi = { getFraudReport, submitFraudReport };
