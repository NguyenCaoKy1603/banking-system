import { isFraudReportResponse } from "@/features/fraud/validation/fraudReportValidators";

describe("fraud report validator", () => {
  it("accepts a received report", () => {
    expect(
      isFraudReportResponse({
        reportId: "report-1",
        status: "RECEIVED",
        createdAt: "2026-08-14T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("rejects unknown report status", () => {
    expect(
      isFraudReportResponse({
        reportId: "report-1",
        status: "CLOSED",
        createdAt: "2026-08-14T00:00:00Z",
      }),
    ).toBe(false);
  });
});
