import type { FraudReportResponse } from "@/features/fraud/types/fraudReport";
import { isNonEmptyDateTime } from "@/services/api/responseValidators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFraudReportResponse(value: unknown): value is FraudReportResponse {
  return (
    isRecord(value) &&
    typeof value.reportId === "string" &&
    value.reportId.trim().length > 0 &&
    value.status === "RECEIVED" &&
    isNonEmptyDateTime(value.createdAt)
  );
}
