import type {
  FinancialAdviceFormValues,
  FinancialAdviceOptionId,
  FinancialAdviceReasonId,
  FinancialAdviceRequest,
  FinancialAdviceResponse,
} from "../types/financialAdvice";

export const MAX_AMOUNT_MINOR = 1_000_000_000_000n;
export const MIN_MONTHS = 1;
export const MAX_MONTHS = 120;

const CANONICAL_DIGITS_REGEX = /^(?:0|[1-9]\d*)$/;
const SIGNED_CANONICAL_REGEX = /^(?:0|-?[1-9]\d*)$/;

export function isCanonicalDigits(value: string): boolean {
  return CANONICAL_DIGITS_REGEX.test(value);
}

export function isSignedCanonical(value: string): boolean {
  return SIGNED_CANONICAL_REGEX.test(value);
}

/** Accept plain integers or correctly grouped Vietnamese thousands (dot only). */
export function sanitizeToCanonicalDigits(raw: string): string | null {
  if (raw.length > 64) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^[0-9]+$/.test(trimmed)) {
    return trimmed.replace(/^0+(?=\d)/, "");
  }
  if (/^[1-9][0-9]{0,2}(?:\.[0-9]{3})+$/.test(trimmed)) {
    return trimmed.replace(/\./g, "");
  }
  return null;
}

export function formatVnd(minor: string): string {
  if (!isCanonicalDigits(minor)) return `${minor} ₫`;
  return `${minor.replace(/\B(?=(\d{3})+(?!\d))/g, ".")} ₫`;
}

export function formatSignedVnd(signedMinor: string): string {
  if (!isSignedCanonical(signedMinor)) return `${signedMinor} ₫`;
  if (signedMinor === "0") return "0 ₫";
  const negative = signedMinor.startsWith("-");
  const absolute = negative ? signedMinor.slice(1) : signedMinor;
  const formatted = absolute.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return negative ? `-${formatted} ₫` : `+${formatted} ₫`;
}

export type FormValidationResult = {
  isValid: boolean;
  fieldErrors: Record<string, string>;
  request?: FinancialAdviceRequest;
};

export function validateFinancialAdviceForm(values: FinancialAdviceFormValues): FormValidationResult {
  const fieldErrors: Record<string, string> = {};
  const validateMoneyField = (
    fieldKey: string,
    rawValue: string,
    label: string,
    requirePositive = false,
  ): string | null => {
    if (rawValue.trim() === "") {
      fieldErrors[fieldKey] = `Vui lòng nhập ${label.toLowerCase()}.`;
      return null;
    }
    const canonical = sanitizeToCanonicalDigits(rawValue);
    if (canonical === null || !isCanonicalDigits(canonical)) {
      fieldErrors[fieldKey] = `${label} phải là số nguyên VND hoặc dùng dấu chấm phân nhóm nghìn đúng.`;
      return null;
    }
    if (canonical.length > 13) {
      fieldErrors[fieldKey] = `${label} không được vượt quá 1.000.000.000.000 ₫.`;
      return null;
    }
    const value = BigInt(canonical);
    if (value > MAX_AMOUNT_MINOR) {
      fieldErrors[fieldKey] = `${label} không được vượt quá 1.000.000.000.000 ₫.`;
      return null;
    }
    if (requirePositive && value === 0n) {
      fieldErrors[fieldKey] = `${label} phải lớn hơn 0 ₫.`;
      return null;
    }
    return canonical;
  };

  const income = validateMoneyField("monthlyIncomeMinor", values.monthlyIncomeMinor, "Thu nhập hàng tháng");
  const essential = validateMoneyField("essentialExpensesMinor", values.essentialExpensesMinor, "Chi tiêu thiết yếu");
  const flexible = validateMoneyField("flexibleExpensesMinor", values.flexibleExpensesMinor, "Chi tiêu linh hoạt");
  const debt = validateMoneyField("monthlyDebtPaymentsMinor", values.monthlyDebtPaymentsMinor, "Khoản trả nợ hàng tháng");
  const buffer = validateMoneyField("monthlyBufferMinor", values.monthlyBufferMinor, "Khoản giữ lại dự phòng");

  let targetAmount: string | null = null;
  let alreadySaved: string | null = null;
  let months: number | null = null;
  let monthlySavingsTarget: string | null = null;

  if (values.kind === "SAVINGS_PLAN") {
    targetAmount = validateMoneyField("targetAmountMinor", values.targetAmountMinor, "Số tiền mục tiêu", true);
    alreadySaved = validateMoneyField("alreadySavedMinor", values.alreadySavedMinor, "Số tiền đã dành riêng");
    if (values.months.trim() === "") {
      fieldErrors.months = "Vui lòng nhập thời hạn mục tiêu (tháng).";
    } else if (!/^[0-9]{1,3}$/.test(values.months.trim())) {
      fieldErrors.months = "Thời hạn mục tiêu phải là số nguyên từ 1 đến 120.";
    } else {
      const parsedMonths = Number(values.months.trim());
      if (parsedMonths < MIN_MONTHS || parsedMonths > MAX_MONTHS) {
        fieldErrors.months = "Thời hạn mục tiêu phải từ 1 đến 120 tháng.";
      } else {
        months = parsedMonths;
      }
    }
  } else {
    monthlySavingsTarget = validateMoneyField("monthlySavingsTargetMinor", values.monthlySavingsTargetMinor, "Mức tiết kiệm mong muốn");
  }

  if (!values.excludeDebtFromExpensesConfirmation) {
    fieldErrors.excludeDebtFromExpensesConfirmation = "Vui lòng xác nhận các khoản chi trên chưa tính trùng khoản trả nợ.";
  }
  if (Object.keys(fieldErrors).length) return { isValid: false, fieldErrors };

  const common = {
    schemaVersion: "1" as const,
    currency: "VND" as const,
    monthlyIncomeMinor: income!,
    essentialExpensesMinor: essential!,
    flexibleExpensesMinor: flexible!,
    monthlyDebtPaymentsMinor: debt!,
    monthlyBufferMinor: buffer!,
    preference: values.preference,
    inputConfirmed: true as const,
  };
  if (values.kind === "SAVINGS_PLAN") {
    return {
      isValid: true,
      fieldErrors,
      request: {
        ...common,
        kind: "SAVINGS_PLAN",
        goal: { targetAmountMinor: targetAmount!, alreadySavedMinor: alreadySaved!, months: months! },
      },
    };
  }
  return {
    isValid: true,
    fieldErrors,
    request: { ...common, kind: "BUDGET_BALANCE", monthlySavingsTargetMinor: monthlySavingsTarget! },
  };
}

type UnknownRecord = Record<string, unknown>;
function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function allStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const OPTION_IDS: readonly FinancialAdviceOptionId[] = [
  "MAINTAIN_PLAN", "GOAL_ALREADY_FUNDED", "EXTEND_DEADLINE", "REDUCE_FLEXIBLE_SPENDING",
  "LOWER_GOAL_AMOUNT", "REVIEW_BASE_BUDGET", "MAINTAIN_BUDGET", "ADJUST_SAVINGS_TARGET",
];
const REASON_IDS: readonly FinancialAdviceReasonId[] = [
  "TARGET_ALREADY_FUNDED", "MONTHLY_GAP", "GOAL_FEASIBLE", "BUDGET_TARGET_MET",
  "BASE_BUDGET_DEFICIT", "BUFFER_NOT_COVERED", "NO_SAVING_CAPACITY", "PRESERVE_CURRENT_SPENDING",
  "KEEP_TARGET_WITH_FLEXIBLE_CUT", "ADJUST_GOAL_TO_CAPACITY", "EXTEND_TIME_TO_CAPACITY", "REVIEW_DECLARED_INPUTS",
];
const CHANGE_KEYS: Record<FinancialAdviceOptionId, readonly string[]> = {
  GOAL_ALREADY_FUNDED: [],
  MAINTAIN_PLAN: ["monthlySavingsMinor", "remainingBufferMinor"],
  EXTEND_DEADLINE: ["months"],
  REDUCE_FLEXIBLE_SPENDING: ["reductionMinor", "newFlexibleExpensesMinor"],
  LOWER_GOAL_AMOUNT: ["targetAmountMinor"],
  REVIEW_BASE_BUDGET: [],
  MAINTAIN_BUDGET: ["monthlySavingsTargetMinor", "remainingAfterTargetMinor"],
  ADJUST_SAVINGS_TARGET: ["monthlySavingsTargetMinor"],
};
const SAVINGS_METRIC_KEYS = [
  "declaredOutgoingsMinor", "unallocatedBeforeBufferMinor", "capacityAfterBufferMinor", "bufferShortfallMinor",
  "remainingGoalMinor", "requiredMonthlySavingsMinor", "monthlyGapMinor", "achievableGoalAtDeadlineMinor",
  "suggestedMonths", "horizonExceeded",
];
const BUDGET_METRIC_KEYS = [
  "declaredOutgoingsMinor", "unallocatedBeforeBufferMinor", "capacityAfterBufferMinor",
  "maximumSavingsAtCurrentBudgetMinor", "targetGapMinor", "remainingAfterTargetMinor", "baseDeficitMinor", "bufferShortfallMinor",
];
const SIGNED_METRICS = new Set(["unallocatedBeforeBufferMinor", "capacityAfterBufferMinor", "remainingAfterTargetMinor"]);

function validMetricObject(kind: "SAVINGS_PLAN" | "BUDGET_BALANCE", value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = kind === "SAVINGS_PLAN" ? SAVINGS_METRIC_KEYS : BUDGET_METRIC_KEYS;
  if (!exactKeys(value, keys)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === "suggestedMonths") {
      if (item !== null && (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 120)) return false;
    } else if (key === "horizonExceeded") {
      if (typeof item !== "boolean") return false;
    } else if (typeof item !== "string" || !(SIGNED_METRICS.has(key) ? isSignedCanonical(item) : isCanonicalDigits(item))) {
      return false;
    }
  }
  return true;
}

function validOption(value: unknown): value is FinancialAdviceResponse["options"][number] {
  if (!isRecord(value) || !exactKeys(value, ["id", "title", "description", "changes"])) return false;
  if (typeof value.id !== "string" || !OPTION_IDS.includes(value.id as FinancialAdviceOptionId)) return false;
  if (typeof value.title !== "string" || typeof value.description !== "string" || !isRecord(value.changes)) return false;
  const allowedChangeKeys = CHANGE_KEYS[value.id as FinancialAdviceOptionId];
  if (Object.keys(value.changes).some((key) => !allowedChangeKeys.includes(key))) return false;
  if (Object.keys(value.changes).length !== allowedChangeKeys.length) return false;
  for (const [key, item] of Object.entries(value.changes)) {
    if (key === "months") {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 1 || item > 120) return false;
    } else if (typeof item !== "string" || !isCanonicalDigits(item)) return false;
  }
  return true;
}

export function isFinancialAdviceResponse(payload: unknown): payload is FinancialAdviceResponse {
  if (!isRecord(payload) || (payload.kind !== "SAVINGS_PLAN" && payload.kind !== "BUDGET_BALANCE")) return false;
  const kind = payload.kind;
  const rootKeys = [
    "schemaVersion", "kind", "currency", "source", "calculationVersion", "catalogVersion", "budgetStatus",
    ...(kind === "SAVINGS_PLAN" ? ["goalStatus"] : ["savingsTargetStatus"]),
    "metrics", "options", "preferredOptionId", "explanation", "assumptions", "warnings",
  ];
  if (!exactKeys(payload, rootKeys)) return false;
  if (payload.schemaVersion !== "1" || payload.currency !== "VND" || payload.source !== "USER_ENTERED") return false;
  if (typeof payload.calculationVersion !== "string" || typeof payload.catalogVersion !== "string") return false;
  if (!["DEFICIT", "BALANCED", "SURPLUS"].includes(payload.budgetStatus as string)) return false;
  if (kind === "SAVINGS_PLAN" && !["ALREADY_FUNDED", "FEASIBLE", "GAP", "NO_CAPACITY"].includes(payload.goalStatus as string)) return false;
  if (kind === "BUDGET_BALANCE" && !["MET", "GAP"].includes(payload.savingsTargetStatus as string)) return false;
  if (!validMetricObject(kind, payload.metrics)) return false;
  if (!Array.isArray(payload.options) || payload.options.length === 0 || !payload.options.every(validOption)) return false;
  const options = payload.options as FinancialAdviceResponse["options"];
  if (new Set(options.map((option) => option.id)).size !== options.length) return false;
  if (typeof payload.preferredOptionId !== "string" || !options.some((option) => option.id === payload.preferredOptionId)) return false;
  if (!isRecord(payload.explanation) || !exactKeys(payload.explanation, ["mode", "reasonIds", "paragraphs", "fallbackReason"])) return false;
  const explanation = payload.explanation;
  if (explanation.mode !== "AI_ASSISTED" && explanation.mode !== "RULE_BASED") return false;
  if (explanation.mode === "AI_ASSISTED" && explanation.fallbackReason !== null) return false;
  if (explanation.mode === "RULE_BASED" && !["AI_DISABLED", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "PROVIDER_INVALID_OUTPUT", "PROVIDER_BUDGET_EXHAUSTED"].includes(explanation.fallbackReason as string)) return false;
  if (!Array.isArray(explanation.reasonIds) || explanation.reasonIds.length < 1 || !explanation.reasonIds.every((id) => REASON_IDS.includes(id as FinancialAdviceReasonId))) return false;
  if (new Set(explanation.reasonIds).size !== explanation.reasonIds.length) return false;
  if (!allStrings(explanation.paragraphs) || explanation.paragraphs.length === 0) return false;
  if (!Array.isArray(payload.assumptions) || !allStrings(payload.assumptions)) return false;
  if (!Array.isArray(payload.warnings) || !payload.warnings.every((warning) =>
    isRecord(warning) && exactKeys(warning, ["code", "message"]) &&
    ["BASE_BUDGET_DEFICIT", "BUFFER_NOT_COVERED"].includes(warning.code as string) && typeof warning.message === "string",
  )) return false;
  return true;
}
