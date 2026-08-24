import {
  getManualReviewCode,
  requiresManualReview,
  shouldKeepSubmitUnknown,
} from "@/features/banking/domain/submitFailure";
import { ApiError } from "@/services/api/ApiError";

function apiError(status: number | null, code: string): ApiError {
  return new ApiError({ status, code, message: code });
}

describe("shouldKeepSubmitUnknown", () => {
  it.each([
    [null, "NETWORK_ERROR"],
    [null, "TIMEOUT"],
    [null, "REQUEST_ABORTED"],
    [422, "INVALID_RESPONSE"],
    [409, "IDEMPOTENCY_CONFLICT"],
    [409, "IDEMPOTENCY_STATE_MISSING"],
    [409, "QUOTE_ALREADY_USED"],
    [409, "MANUAL_REVIEW_REQUIRED"],
    [409, "REVERSAL_REQUIRES_REVIEW"],
    [401, "UNAUTHORIZED"],
    [408, "REQUEST_TIMEOUT"],
    [425, "TOO_EARLY"],
    [429, "UNKNOWN_RATE_LIMIT"],
    [500, "INTERNAL_ERROR"],
    [503, "SERVICE_UNAVAILABLE"],
  ])("keeps an ambiguous %s/%s outcome", (status, code) => {
    expect(shouldKeepSubmitUnknown(apiError(status, code))).toBe(true);
  });

  it.each([
    [400, "INVALID_REQUEST"],
    [403, "FEATURE_DISABLED"],
    [404, "NOT_FOUND"],
    [409, "INSUFFICIENT_FUNDS"],
    [409, "QUOTE_EXPIRED"],
    [409, "STEP_UP_VERIFICATION_FAILED"],
    [429, "RATE_LIMITED"],
    [422, "VALIDATION_FAILED"],
  ])("treats a structured %s/%s domain response as rejected", (status, code) => {
    expect(shouldKeepSubmitUnknown(apiError(status, code))).toBe(false);
  });

  it("keeps unexpected non-API failures conservative", () => {
    expect(shouldKeepSubmitUnknown(new Error("unexpected"))).toBe(true);
  });

  it.each([
    "IDEMPOTENCY_CONFLICT",
    "IDEMPOTENCY_STATE_MISSING",
    "MANUAL_REVIEW_REQUIRED",
    "QUOTE_ALREADY_USED",
    "REVERSAL_REQUIRES_REVIEW",
  ])("requires manual review for %s", (code) => {
    const error = apiError(409, code);

    expect(requiresManualReview(error)).toBe(true);
    expect(getManualReviewCode(error)).toBe(code);
  });

  it("does not turn transport ambiguity into a manual-review state", () => {
    const error = apiError(null, "NETWORK_ERROR");

    expect(requiresManualReview(error)).toBe(false);
    expect(getManualReviewCode(error)).toBeNull();
  });
});
