export type FinancialAdviceKind = "SAVINGS_PLAN" | "BUDGET_BALANCE";
export type FinancialAdvicePreference = "KEEP_TARGET" | "KEEP_CURRENT_SPENDING" | "BALANCED";
export type FinancialAdviceMode = "AI_ASSISTED" | "RULE_BASED";
export type FinancialAdviceFallbackReason =
  | "AI_DISABLED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_INVALID_OUTPUT"
  | "PROVIDER_BUDGET_EXHAUSTED";

export type FinancialAdviceOptionId =
  | "MAINTAIN_PLAN"
  | "GOAL_ALREADY_FUNDED"
  | "EXTEND_DEADLINE"
  | "REDUCE_FLEXIBLE_SPENDING"
  | "LOWER_GOAL_AMOUNT"
  | "REVIEW_BASE_BUDGET"
  | "MAINTAIN_BUDGET"
  | "ADJUST_SAVINGS_TARGET";

export type FinancialAdviceReasonId =
  | "TARGET_ALREADY_FUNDED"
  | "MONTHLY_GAP"
  | "GOAL_FEASIBLE"
  | "BUDGET_TARGET_MET"
  | "BASE_BUDGET_DEFICIT"
  | "BUFFER_NOT_COVERED"
  | "NO_SAVING_CAPACITY"
  | "PRESERVE_CURRENT_SPENDING"
  | "KEEP_TARGET_WITH_FLEXIBLE_CUT"
  | "ADJUST_GOAL_TO_CAPACITY"
  | "EXTEND_TIME_TO_CAPACITY"
  | "REVIEW_DECLARED_INPUTS";

export type FinancialAdviceWarningCode = "BASE_BUDGET_DEFICIT" | "BUFFER_NOT_COVERED";
export type BudgetStatus = "DEFICIT" | "BALANCED" | "SURPLUS";
export type SavingsGoalStatus = "ALREADY_FUNDED" | "FEASIBLE" | "GAP" | "NO_CAPACITY";
export type BudgetSavingsTargetStatus = "MET" | "GAP";

export type BaseFinancialAdviceRequest = {
  schemaVersion: "1";
  kind: FinancialAdviceKind;
  currency: "VND";
  monthlyIncomeMinor: string;
  essentialExpensesMinor: string;
  flexibleExpensesMinor: string;
  monthlyDebtPaymentsMinor: string;
  monthlyBufferMinor: string;
  preference: FinancialAdvicePreference;
  inputConfirmed: true;
};

export type SavingsGoalInput = {
  targetAmountMinor: string;
  alreadySavedMinor: string;
  months: number;
};

export type FinancialAdviceSavingsRequest = BaseFinancialAdviceRequest & {
  kind: "SAVINGS_PLAN";
  goal: SavingsGoalInput;
};

export type FinancialAdviceBudgetRequest = BaseFinancialAdviceRequest & {
  kind: "BUDGET_BALANCE";
  monthlySavingsTargetMinor: string;
};

export type FinancialAdviceRequest = FinancialAdviceSavingsRequest | FinancialAdviceBudgetRequest;

export type FinancialAdviceFormValues = {
  kind: FinancialAdviceKind;
  monthlyIncomeMinor: string;
  essentialExpensesMinor: string;
  flexibleExpensesMinor: string;
  monthlyDebtPaymentsMinor: string;
  monthlyBufferMinor: string;
  preference: FinancialAdvicePreference;
  excludeDebtFromExpensesConfirmation: boolean;
  targetAmountMinor: string;
  alreadySavedMinor: string;
  months: string;
  monthlySavingsTargetMinor: string;
};

export type FinancialAdviceOption = {
  id: FinancialAdviceOptionId;
  title: string;
  description: string;
  changes: Record<string, string | number>;
};

export type FinancialAdviceWarning = {
  code: FinancialAdviceWarningCode;
  message: string;
};

export type FinancialAdviceExplanation = {
  mode: FinancialAdviceMode;
  reasonIds: FinancialAdviceReasonId[];
  paragraphs: string[];
  fallbackReason: FinancialAdviceFallbackReason | null;
};

export type SavingsPlanMetrics = {
  declaredOutgoingsMinor: string;
  unallocatedBeforeBufferMinor: string;
  capacityAfterBufferMinor: string;
  bufferShortfallMinor: string;
  remainingGoalMinor: string;
  requiredMonthlySavingsMinor: string;
  monthlyGapMinor: string;
  achievableGoalAtDeadlineMinor: string;
  suggestedMonths: number | null;
  horizonExceeded: boolean;
};

export type BudgetBalanceMetrics = {
  declaredOutgoingsMinor: string;
  unallocatedBeforeBufferMinor: string;
  capacityAfterBufferMinor: string;
  maximumSavingsAtCurrentBudgetMinor: string;
  targetGapMinor: string;
  remainingAfterTargetMinor: string;
  baseDeficitMinor: string;
  bufferShortfallMinor: string;
};

type FinancialAdviceResponseBase = {
  schemaVersion: "1";
  currency: "VND";
  source: "USER_ENTERED";
  calculationVersion: string;
  catalogVersion: string;
  budgetStatus: BudgetStatus;
  options: FinancialAdviceOption[];
  preferredOptionId: FinancialAdviceOptionId;
  explanation: FinancialAdviceExplanation;
  assumptions: string[];
  warnings: FinancialAdviceWarning[];
};

export type SavingsPlanAdviceResponse = FinancialAdviceResponseBase & {
  kind: "SAVINGS_PLAN";
  goalStatus: SavingsGoalStatus;
  metrics: SavingsPlanMetrics;
};

export type BudgetBalanceAdviceResponse = FinancialAdviceResponseBase & {
  kind: "BUDGET_BALANCE";
  savingsTargetStatus: BudgetSavingsTargetStatus;
  metrics: BudgetBalanceMetrics;
};

export type FinancialAdviceResponse = SavingsPlanAdviceResponse | BudgetBalanceAdviceResponse;
