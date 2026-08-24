import { ApiError } from "@/services/api/ApiError";

const MANUAL_REVIEW_CODES = [
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_STATE_MISSING",
  "MANUAL_REVIEW_REQUIRED",
  "QUOTE_ALREADY_USED",
  "REVERSAL_REQUIRES_REVIEW",
] as const;

export type ManualReviewCode = (typeof MANUAL_REVIEW_CODES)[number];

const UNKNOWN_OUTCOME_CODES = new Set([
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_STATE_MISSING",
  "INVALID_RESPONSE",
  "MANUAL_REVIEW_REQUIRED",
  "NETWORK_ERROR",
  "QUOTE_ALREADY_USED",
  "REQUEST_ABORTED",
  "REVERSAL_REQUIRES_REVIEW",
  "TIMEOUT",
]);

const UNKNOWN_OUTCOME_HTTP_STATUSES = new Set([401, 408, 425, 429]);

export function isManualReviewCode(value: unknown): value is ManualReviewCode {
  return (
    typeof value === "string" &&
    (MANUAL_REVIEW_CODES as readonly string[]).includes(value)
  );
}

export function getManualReviewCode(
  error: unknown,
): ManualReviewCode | null {
  return error instanceof ApiError && isManualReviewCode(error.code)
    ? error.code
    : null;
}

export function requiresManualReview(
  error: unknown,
): error is ApiError & { readonly code: ManualReviewCode } {
  return getManualReviewCode(error) !== null;
}

/**
 * A submit remains unknown only when the client cannot prove whether the
 * server accepted it. Other structured 4xx responses are known rejections.
 */
export function shouldKeepSubmitUnknown(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true;
  }

  // The banking backend emits this structured rejection before dispatch. An
  // unstructured/unexpected 429 remains conservative below.
  if (error.status === 429 && error.code === "RATE_LIMITED") {
    return false;
  }

  if (UNKNOWN_OUTCOME_CODES.has(error.code)) {
    return true;
  }

  if (error.status === null) {
    return true;
  }

  return (
    UNKNOWN_OUTCOME_HTTP_STATUSES.has(error.status) || error.status >= 500
  );
}
