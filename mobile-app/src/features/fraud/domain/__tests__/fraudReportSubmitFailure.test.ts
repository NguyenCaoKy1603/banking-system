import { getFraudReportSubmitFailureDisposition } from "@/features/fraud/domain/fraudReportSubmitFailure";
import { ApiError } from "@/services/api/ApiError";

function apiError(status: number | null, code: string): ApiError {
  return new ApiError({ status, code, message: code });
}

describe("getFraudReportSubmitFailureDisposition", () => {
  it.each([
    [null, "NETWORK_ERROR"],
    [null, "TIMEOUT"],
    [422, "INVALID_RESPONSE"],
    [500, "INTERNAL_ERROR"],
    [401, "UNAUTHORIZED"],
  ])("retains an ambiguous %s/%s request", (status, code) => {
    expect(
      getFraudReportSubmitFailureDisposition(apiError(status, code)),
    ).toBe("RETRY_SAME_REQUEST");
  });

  it("abandons an idempotency conflict instead of retrying forever", () => {
    expect(
      getFraudReportSubmitFailureDisposition(
        apiError(409, "IDEMPOTENCY_CONFLICT"),
      ),
    ).toBe("RESET_IDEMPOTENCY_CONFLICT");
  });

  it("shows a dedicated outcome for an existing fraud case", () => {
    expect(
      getFraudReportSubmitFailureDisposition(
        apiError(409, "FRAUD_REPORT_ALREADY_EXISTS"),
      ),
    ).toBe("RESET_ALREADY_EXISTS");
  });

  it("resets a known domain rejection", () => {
    expect(
      getFraudReportSubmitFailureDisposition(
        apiError(422, "VALIDATION_FAILED"),
      ),
    ).toBe("RESET_REJECTED");
  });
});
