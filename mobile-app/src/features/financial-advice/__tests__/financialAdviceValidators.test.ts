import {
  formatSignedVnd,
  formatVnd,
  isCanonicalDigits,
  isFinancialAdviceResponse,
  isSignedCanonical,
  sanitizeToCanonicalDigits,
  validateFinancialAdviceForm,
} from "@/features/financial-advice/validation/financialAdviceValidators";
import type { FinancialAdviceFormValues } from "@/features/financial-advice/types/financialAdvice";

describe("financialAdviceValidators", () => {
  describe("isCanonicalDigits & isSignedCanonical", () => {
    it("nhận diện canonical digits hợp lệ", () => {
      expect(isCanonicalDigits("0")).toBe(true);
      expect(isCanonicalDigits("1000")).toBe(true);
      expect(isCanonicalDigits("1234567890123")).toBe(true);
      expect(isCanonicalDigits("01")).toBe(false);
      expect(isCanonicalDigits("-100")).toBe(false);
      expect(isCanonicalDigits("1.5")).toBe(false);
      expect(isCanonicalDigits("abc")).toBe(false);
    });

    it("nhận diện signed canonical hợp lệ", () => {
      expect(isSignedCanonical("0")).toBe(true);
      expect(isSignedCanonical("500000")).toBe(true);
      expect(isSignedCanonical("-500000")).toBe(true);
      expect(isSignedCanonical("-0")).toBe(false);
      expect(isSignedCanonical("-01")).toBe(false);
    });
  });

  describe("sanitizeToCanonicalDigits", () => {
    it("chuẩn hóa chuỗi rỗng thành rỗng", () => {
      expect(sanitizeToCanonicalDigits("")).toBe("");
      expect(sanitizeToCanonicalDigits("   ")).toBe("");
    });

    it("chuẩn hóa chuỗi chỉ chứa số", () => {
      expect(sanitizeToCanonicalDigits("10000000")).toBe("10000000");
      expect(sanitizeToCanonicalDigits("0")).toBe("0");
      expect(sanitizeToCanonicalDigits("00500")).toBe("500");
    });

    it("chấp nhận số nguyên và dấu chấm nhóm nghìn hợp lệ", () => {
      expect(sanitizeToCanonicalDigits("10.000.000")).toBe("10000000");
      expect(sanitizeToCanonicalDigits("1.500")).toBe("1500");
      expect(sanitizeToCanonicalDigits(" 10000000 ")).toBe("10000000");
      expect(sanitizeToCanonicalDigits("10,000,000")).toBeNull();
      expect(sanitizeToCanonicalDigits("10 000 000")).toBeNull();
      expect(sanitizeToCanonicalDigits("1.5")).toBeNull();
      expect(sanitizeToCanonicalDigits("12.34.567")).toBeNull();
    });

    it("từ chối chuỗi có chữ cái hoặc ký tự lạ, không strip bừa bãi", () => {
      expect(sanitizeToCanonicalDigits("1.5 triệu")).toBeNull();
      expect(sanitizeToCanonicalDigits("100k")).toBeNull();
      expect(sanitizeToCanonicalDigits("$500")).toBeNull();
      expect(sanitizeToCanonicalDigits("-500000")).toBeNull();
      expect(sanitizeToCanonicalDigits("+500000")).toBeNull();
    });
  });

  describe("formatVnd & formatSignedVnd", () => {
    it("định dạng formatVnd chính xác", () => {
      expect(formatVnd("0")).toBe("0 ₫");
      expect(formatVnd("10000000")).toBe("10.000.000 ₫");
      expect(formatVnd("500")).toBe("500 ₫");
    });

    it("định dạng formatSignedVnd rõ dấu âm và dương", () => {
      expect(formatSignedVnd("0")).toBe("0 ₫");
      expect(formatSignedVnd("1500000")).toBe("+1.500.000 ₫");
      expect(formatSignedVnd("-500000")).toBe("-500.000 ₫");
    });
  });

  describe("validateFinancialAdviceForm", () => {
    const validSavingsForm: FinancialAdviceFormValues = {
      kind: "SAVINGS_PLAN",
      monthlyIncomeMinor: "10.000.000",
      essentialExpensesMinor: "6.000.000",
      flexibleExpensesMinor: "2.000.000",
      monthlyDebtPaymentsMinor: "500.000",
      monthlyBufferMinor: "0",
      preference: "KEEP_TARGET",
      excludeDebtFromExpensesConfirmation: true,
      targetAmountMinor: "12.000.000",
      alreadySavedMinor: "2.000.000",
      months: "5",
      monthlySavingsTargetMinor: "",
    };

    it("hợp lệ với form SAVINGS_PLAN", () => {
      const res = validateFinancialAdviceForm(validSavingsForm);
      expect(res.isValid).toBe(true);
      expect(res.request).toBeDefined();
      expect(res.request?.kind).toBe("SAVINGS_PLAN");
      if (res.request?.kind === "SAVINGS_PLAN") {
        expect(res.request.monthlyIncomeMinor).toBe("10000000");
        expect(res.request.goal.targetAmountMinor).toBe("12000000");
        expect(res.request.goal.months).toBe(5);
        expect(res.request.preference).toBe("KEEP_TARGET");
        expect(res.request.schemaVersion).toBe("1");
        expect(res.request.currency).toBe("VND");
        expect(res.request.inputConfirmed).toBe(true);
        expect("excludeDebtFromExpensesConfirmation" in res.request).toBe(false);
      }
    });

    it("hợp lệ với form BUDGET_BALANCE", () => {
      const validBudgetForm: FinancialAdviceFormValues = {
        kind: "BUDGET_BALANCE",
        monthlyIncomeMinor: "10000000",
        essentialExpensesMinor: "6000000",
        flexibleExpensesMinor: "2000000",
        monthlyDebtPaymentsMinor: "500000",
        monthlyBufferMinor: "0",
        preference: "BALANCED",
        excludeDebtFromExpensesConfirmation: true,
        targetAmountMinor: "",
        alreadySavedMinor: "",
        months: "",
        monthlySavingsTargetMinor: "2000000",
      };

      const res = validateFinancialAdviceForm(validBudgetForm);
      expect(res.isValid).toBe(true);
      expect(res.request?.kind).toBe("BUDGET_BALANCE");
      if (res.request?.kind === "BUDGET_BALANCE") {
        expect(res.request.monthlySavingsTargetMinor).toBe("2000000");
      }
    });

    it("bắt lỗi khi thiếu các trường tiền bắt buộc", () => {
      const emptyForm: FinancialAdviceFormValues = {
        ...validSavingsForm,
        monthlyIncomeMinor: "",
        essentialExpensesMinor: "",
      };
      const res = validateFinancialAdviceForm(emptyForm);
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors["monthlyIncomeMinor"]).toBeDefined();
      expect(res.fieldErrors["essentialExpensesMinor"]).toBeDefined();
    });

    it("bắt lỗi khi số tiền mục tiêu = 0", () => {
      const zeroTargetForm: FinancialAdviceFormValues = {
        ...validSavingsForm,
        targetAmountMinor: "0",
      };
      const res = validateFinancialAdviceForm(zeroTargetForm);
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors["targetAmountMinor"]).toContain("lớn hơn 0");
    });

    it("bắt lỗi khi thời hạn tháng ngoài khoảng 1-120", () => {
      const invalidMonthsForm: FinancialAdviceFormValues = {
        ...validSavingsForm,
        months: "150",
      };
      const res = validateFinancialAdviceForm(invalidMonthsForm);
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors["months"]).toContain("từ 1 đến 120 tháng");
    });

    it("bắt lỗi khi chưa xác nhận không tính trùng nợ", () => {
      const unconfirmedForm: FinancialAdviceFormValues = {
        ...validSavingsForm,
        excludeDebtFromExpensesConfirmation: false,
      };
      const res = validateFinancialAdviceForm(unconfirmedForm);
      expect(res.isValid).toBe(false);
      expect(res.fieldErrors["excludeDebtFromExpensesConfirmation"]).toBeDefined();
    });
  });

  describe("isFinancialAdviceResponse", () => {
    it("nhận diện response SAVINGS_PLAN hợp lệ", () => {
      const validPayload = {
        schemaVersion: "1",
        kind: "SAVINGS_PLAN",
        currency: "VND",
        source: "USER_ENTERED",
        calculationVersion: "fa-calc-v1",
        catalogVersion: "fa-catalog-v2",
        budgetStatus: "SURPLUS",
        goalStatus: "GAP",
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
        options: [
          {
            id: "EXTEND_DEADLINE",
            title: "Kéo dài thời hạn",
            description: "Cân nhắc kéo dài thời hạn.",
            changes: { months: 7 },
          },
        ],
        preferredOptionId: "EXTEND_DEADLINE",
        explanation: {
          mode: "AI_ASSISTED",
          reasonIds: ["MONTHLY_GAP"],
          paragraphs: ["Đoạn 1"],
          fallbackReason: null,
        },
        assumptions: ["Giả định 1"],
        warnings: [],
      };

      expect(isFinancialAdviceResponse(validPayload)).toBe(true);
      expect(isFinancialAdviceResponse({
        ...validPayload,
        metrics: { ...validPayload.metrics, suggestedMonths: 0 },
      })).toBe(true);
      expect(isFinancialAdviceResponse({
        ...validPayload,
        metrics: { ...validPayload.metrics, suggestedMonths: 121 },
      })).toBe(false);
    });

    it("từ chối response không đúng định dạng", () => {
      expect(isFinancialAdviceResponse(null)).toBe(false);
      expect(isFinancialAdviceResponse({})).toBe(false);
      expect(isFinancialAdviceResponse({ kind: "UNKNOWN" })).toBe(false);
      expect(isFinancialAdviceResponse({ kind: "SAVINGS_PLAN", mode: "OTHER" })).toBe(false);
      const validPayload = {
        schemaVersion: "1", kind: "SAVINGS_PLAN", currency: "VND", source: "USER_ENTERED",
        calculationVersion: "fa-calc-v1", catalogVersion: "fa-catalog-v2", budgetStatus: "SURPLUS",
        goalStatus: "GAP",
        metrics: {
          declaredOutgoingsMinor: "8500000", unallocatedBeforeBufferMinor: "1500000",
          capacityAfterBufferMinor: "1500000", bufferShortfallMinor: "0", remainingGoalMinor: "10000000",
          requiredMonthlySavingsMinor: "2000000", monthlyGapMinor: "500000",
          achievableGoalAtDeadlineMinor: "9500000", suggestedMonths: 7, horizonExceeded: false,
        },
        options: [{ id: "EXTEND_DEADLINE", title: "Kéo dài", description: "Mô tả", changes: { months: 7 } }],
        preferredOptionId: "EXTEND_DEADLINE",
        explanation: { mode: "AI_ASSISTED", reasonIds: ["MONTHLY_GAP"], paragraphs: ["Đoạn"], fallbackReason: null },
        assumptions: [], warnings: [],
      };
      expect(isFinancialAdviceResponse({ ...validPayload, unexpected: true })).toBe(false);
      expect(isFinancialAdviceResponse({ ...validPayload, explanation: { ...validPayload.explanation, fallbackReason: "PROVIDER_TIMEOUT" } })).toBe(false);
    });
  });
});
