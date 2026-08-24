import { shouldKeepSubmitUnknown } from "@/features/banking/domain/submitFailure";
import { ApiError } from "@/services/api/ApiError";

export type FraudReportSubmitFailureDisposition =
  | "RETRY_SAME_REQUEST"
  | "RESET_ALREADY_EXISTS"
  | "RESET_IDEMPOTENCY_CONFLICT"
  | "RESET_REJECTED";

/**
 * Fraud reports do not have a quote/status lookup before a receipt exists.
 * Preserve the durable request only when server acceptance is genuinely
 * ambiguous. A body/key conflict proves this request was rejected and must
 * be abandoned before the user can submit a fresh key.
 */
export function getFraudReportSubmitFailureDisposition(
  error: unknown,
): FraudReportSubmitFailureDisposition {
  if (error instanceof ApiError) {
    if (error.code === "FRAUD_REPORT_ALREADY_EXISTS") {
      return "RESET_ALREADY_EXISTS";
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return "RESET_IDEMPOTENCY_CONFLICT";
    }
  }

  return shouldKeepSubmitUnknown(error)
    ? "RETRY_SAME_REQUEST"
    : "RESET_REJECTED";
}
