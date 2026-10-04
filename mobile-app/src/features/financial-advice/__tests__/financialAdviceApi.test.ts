import {
  getFinancialAdvice,
  mapFinancialAdviceError,
} from "@/features/financial-advice/api/financialAdviceApi";
import type { FinancialAdviceRequest } from "@/features/financial-advice/types/financialAdvice";
import * as httpClient from "@/services/api/httpClient";
import { ApiError } from "@/services/api/ApiError";

jest.mock("@/services/api/httpClient");

const requestJsonMock = jest.mocked(httpClient.requestJson);

describe("financialAdviceApi", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockRequest: FinancialAdviceRequest = {
    schemaVersion: "1",
    kind: "SAVINGS_PLAN",
    currency: "VND",
    monthlyIncomeMinor: "10000000",
    essentialExpensesMinor: "6000000",
    flexibleExpensesMinor: "2000000",
    monthlyDebtPaymentsMinor: "500000",
    monthlyBufferMinor: "0",
    preference: "KEEP_TARGET",
    inputConfirmed: true,
    goal: {
      targetAmountMinor: "12000000",
      alreadySavedMinor: "2000000",
      months: 5,
    },
  };

  it("gọi requestJson với đúng URL, method, body và headers", async () => {
    const mockResponse = {
      schemaVersion: "1",
      kind: "SAVINGS_PLAN" as const,
      currency: "VND" as const,
      source: "USER_ENTERED" as const,
      calculationVersion: "fa-calc-v1",
      catalogVersion: "fa-catalog-v2",
      budgetStatus: "SURPLUS" as const,
      goalStatus: "GAP" as const,
      metrics: {
        declaredOutgoingsMinor: "8500000",
        unallocatedBeforeBufferMinor: "1500000",
        capacityAfterBufferMinor: "1500000",
        bufferShortfallMinor: "0",
        remainingGoalMinor: "10000000",
        requiredMonthlySavingsMinor: "2000000",
        monthlyGapMinor: "500000",
        achievableGoalAtDeadlineMinor: "9500000",
        suggestedMonths: 7,
        horizonExceeded: false,
      },
      options: [{ id: "EXTEND_DEADLINE", title: "Kéo dài", description: "Mô tả", changes: { months: 7 } }],
      preferredOptionId: "EXTEND_DEADLINE" as const,
      explanation: {
        mode: "AI_ASSISTED" as const,
        reasonIds: ["MONTHLY_GAP" as const],
        paragraphs: ["Đoạn 1"],
        fallbackReason: null,
      },
      assumptions: ["Giả định"],
      warnings: [],
    };

    requestJsonMock.mockResolvedValueOnce(mockResponse);

    const abortController = new AbortController();
    const result = await getFinancialAdvice(mockRequest, {
      signal: abortController.signal,
      auth: { accessToken: "test-token" },
    });

    expect(requestJsonMock).toHaveBeenCalledWith(
      "/assistant/financial-advice",
      expect.objectContaining({
        method: "POST",
        body: mockRequest,
        signal: abortController.signal,
        auth: { accessToken: "test-token" },
        retryOnUnauthorized: true,
      }),
      expect.any(Function),
    );
    expect(result).toEqual(mockResponse);
  });

  describe("mapFinancialAdviceError", () => {
    it("ánh xạ 401 UNAUTHORIZED thành lỗi phiên đăng nhập", () => {
      const err = new ApiError({
        message: "Phiên hết hạn",
        status: 401,
        code: "UNAUTHORIZED",
      });
      const mapped = mapFinancialAdviceError(err);
      expect(mapped.isAuth).toBe(true);
      expect(mapped.title).toContain("Phiên đăng nhập hết hạn");
    });

    it("ánh xạ 413 BODY_TOO_LARGE thành dữ liệu quá lớn", () => {
      const err = new ApiError({
        message: "Dữ liệu quá lớn",
        status: 413,
        code: "FINANCIAL_ADVICE_BODY_TOO_LARGE",
      });
      const mapped = mapFinancialAdviceError(err);
      expect(mapped.title).toContain("Dữ liệu quá lớn");
    });

    it("ánh xạ 422 VALIDATION_ERROR thành lỗi dữ liệu", () => {
      const err = new ApiError({
        message: "Lỗi dữ liệu",
        status: 422,
        code: "VALIDATION_ERROR",
        fieldErrors: {
          "goal.months": "Phải từ 1 đến 120",
        },
      });
      const mapped = mapFinancialAdviceError(err);
      expect(mapped.title).toContain("Dữ liệu không hợp lệ");
      expect(mapped.fieldErrors?.months).toBe("Phải từ 1 đến 120");
    });

    it("ánh xạ 429 RATE_LIMITED thành hệ thống đang bận", () => {
      const err = new ApiError({
        message: "Rate limited",
        status: 429,
        code: "RATE_LIMITED",
      });
      const mapped = mapFinancialAdviceError(err);
      expect(mapped.isRateLimited).toBe(true);
      expect(mapped.title).toContain("Hệ thống đang bận");
    });

    it("ánh xạ 503 thành dịch vụ tạm dừng", () => {
      const err = new ApiError({
        message: "Unavailable",
        status: 503,
        code: "FINANCIAL_ADVICE_UNAVAILABLE",
      });
      const mapped = mapFinancialAdviceError(err);
      expect(mapped.title).toContain("Tính năng tạm dừng");
    });

    it("ánh xạ 504 thành timeout", () => {
      const err = new ApiError({
        message: "Timeout",
        status: 504,
        code: "FINANCIAL_ADVICE_TIMEOUT",
      });
      const mapped = mapFinancialAdviceError(err);
      expect(mapped.title).toContain("Hết thời gian chờ");
    });

    it("ánh xạ NETWORK_ERROR thành lỗi mạng", () => {
      const err = new ApiError({
        message: "Network error",
        status: 0,
        code: "NETWORK_ERROR",
      });
      const mapped = mapFinancialAdviceError(err);
      expect(mapped.title).toContain("Lỗi kết nối mạng");
    });
  });
});
