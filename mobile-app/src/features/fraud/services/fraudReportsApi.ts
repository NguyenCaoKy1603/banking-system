import type { RequestAuth } from "@/services/api/httpClient";
import { requestJson } from "@/services/api/httpClient";
import type {
  FraudReportRequest,
  FraudReportResponse,
} from "@/features/fraud/types/fraudReport";
import { isFraudReportResponse } from "@/features/fraud/validation/fraudReportValidators";

export function submitFraudReport(
  request: FraudReportRequest,
  auth: RequestAuth,
): Promise<FraudReportResponse> {
  if (
    !request.accountId.trim() ||
    !request.transactionId.trim() ||
    request.reason.trim().length < 5
  ) {
    return Promise.reject(new TypeError("Fraud report fields are invalid."));
  }

  return requestJson<FraudReportResponse>(
    "/fraud-reports",
    { method: "POST", body: request, auth },
    isFraudReportResponse,
  );
}

export const fraudReportsApi = { submitFraudReport };
