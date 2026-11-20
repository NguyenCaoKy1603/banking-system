import {
  getAnomalyStatusPresentation,
  getRiskLevelPresentation,
  getRuleCodeLabel,
} from "@/features/anomalies/presentation/anomalyPresentation";
import {
  isAnomaliesListResponse,
  isAnomalyDetailResponse,
  isTransferAnomalyAssessment,
} from "@/features/anomalies/validation/anomalyResponseValidators";

describe("anomaly detection presentation and validators", () => {
  it("maps risk levels, statuses, and rule codes to Vietnamese labels", () => {
    expect(getRiskLevelPresentation("MEDIUM")).toEqual({
      label: "Cần lưu ý",
      tone: "warning",
    });
    expect(getRiskLevelPresentation("HIGH")).toEqual({
      label: "Bất thường cao",
      tone: "danger",
    });
    expect(getRiskLevelPresentation("CRITICAL")).toEqual({
      label: "Rủi ro nghiêm trọng",
      tone: "danger",
    });
    expect(getAnomalyStatusPresentation("OPEN")).toEqual({
      label: "Chờ xác nhận",
      tone: "warning",
    });
    expect(getAnomalyStatusPresentation("CONFIRMED_SAFE")).toEqual({
      label: "Đã xác nhận an toàn",
      tone: "success",
    });
    expect(getAnomalyStatusPresentation("REPORTED_SUSPICIOUS")).toEqual({
      label: "Đã báo nghi ngờ",
      tone: "danger",
    });
    expect(getRuleCodeLabel("VELOCITY_SPIKE")).toContain("Tần suất");
  });

  it("validates TransferAnomalyAssessment and TransactionAnomaly payloads at runtime", () => {
    const assessment = {
      riskLevel: "HIGH",
      riskScore: 65,
      flagged: true,
      requiresConfirmation: true,
      summary: "Cảnh báo giao dịch bất thường mức cao.",
      flags: [
        {
          code: "HIGH_VALUE_TRANSFER",
          title: "Giao dịch giá trị lớn",
          detail: "Số tiền chuyển vượt ngưỡng cảnh báo.",
          weight: 35,
        },
        {
          code: "NEW_RECIPIENT_HIGH_AMOUNT",
          title: "Chuyển khoản lớn cho người nhận mới",
          detail: "Người nhận chưa từng giao dịch trước đó.",
          weight: 30,
        },
      ],
      evaluatedAt: "2026-11-18T12:00:00.000Z",
    };

    expect(isTransferAnomalyAssessment(assessment)).toBe(true);
    expect(isTransferAnomalyAssessment({ ...assessment, riskScore: 150 })).toBe(false);

    const anomaly = {
      id: "11111111-1111-4111-8111-111111111111",
      customerId: "22222222-2222-4222-8222-222222222222",
      accountId: "33333333-3333-4333-8333-333333333333",
      transferId: "44444444-4444-4444-8444-444444444444",
      transactionId: "55555555-5555-4555-8555-555555555555",
      amount: { currency: "VND", amountMinor: "4000000" },
      counterpartyName: "Nguyễn Văn B",
      maskedDestinationAccount: "•••• 1234",
      riskLevel: "HIGH",
      riskScore: 65,
      ruleCodes: ["HIGH_VALUE_TRANSFER", "NEW_RECIPIENT_HIGH_AMOUNT"],
      summary: assessment.summary,
      flags: assessment.flags,
      status: "OPEN",
      customerNote: null,
      acknowledgedAt: null,
      resolutionCode: null,
      resolvedAt: null,
      createdAt: "2026-11-18T12:00:00.000Z",
      updatedAt: "2026-11-18T12:00:00.000Z",
    };

    expect(isAnomaliesListResponse({ items: [anomaly] })).toBe(true);
    expect(isAnomalyDetailResponse({ anomaly })).toBe(true);
    expect(isAnomaliesListResponse({ items: [{ ...anomaly, riskLevel: "LOW" }] })).toBe(false);
  });
});
