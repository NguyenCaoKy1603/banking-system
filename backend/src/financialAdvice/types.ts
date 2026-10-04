export type FinancialAdviceKind = "SAVINGS_PLAN" | "BUDGET_BALANCE";
export type FinancialPreference = "KEEP_TARGET" | "KEEP_CURRENT_SPENDING" | "BALANCED";

export type BudgetStatus = "DEFICIT" | "BALANCED" | "SURPLUS";
export type SavingsGoalStatus = "ALREADY_FUNDED" | "FEASIBLE" | "GAP" | "NO_CAPACITY";
export type BudgetSavingsTargetStatus = "MET" | "GAP";

export type ExplanationMode = "AI_ASSISTED" | "RULE_BASED";
export type FallbackReason =
  | "AI_DISABLED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_INVALID_OUTPUT"
  | "PROVIDER_BUDGET_EXHAUSTED";

export type SavingsOptionId =
  | "MAINTAIN_PLAN"
  | "GOAL_ALREADY_FUNDED"
  | "EXTEND_DEADLINE"
  | "REDUCE_FLEXIBLE_SPENDING"
  | "LOWER_GOAL_AMOUNT"
  | "REVIEW_BASE_BUDGET";

export type BudgetOptionId =
  | "MAINTAIN_BUDGET"
  | "REDUCE_FLEXIBLE_SPENDING"
  | "ADJUST_SAVINGS_TARGET"
  | "REVIEW_BASE_BUDGET";

export type FinancialOptionId = SavingsOptionId | BudgetOptionId;

export type ReasonId =
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

export type FinancialAdviceWarning = {
  code: string;
  message: string;
};

export type FinancialAdviceOption = {
  id: FinancialOptionId;
  title: string;
  description: string;
  changes: Record<string, unknown>;
};

export type FinancialAdviceExplanation = {
  mode: ExplanationMode;
  reasonIds: ReasonId[];
  paragraphs: string[];
  fallbackReason: FallbackReason | null;
};

export type BaseFinancialAdviceRequest = {
  schemaVersion: "1";
  kind: FinancialAdviceKind;
  currency: "VND";
  monthlyIncomeMinor: string;
  essentialExpensesMinor: string;
  flexibleExpensesMinor: string;
  monthlyDebtPaymentsMinor: string;
  monthlyBufferMinor: string;
  preference: FinancialPreference;
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

export type FinancialAdviceRequest =
  | FinancialAdviceSavingsRequest
  | FinancialAdviceBudgetRequest;

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

export type FinancialAdviceSavingsResponse = {
  schemaVersion: "1";
  kind: "SAVINGS_PLAN";
  currency: "VND";
  source: "USER_ENTERED";
  calculationVersion: string;
  catalogVersion: string;
  budgetStatus: BudgetStatus;
  goalStatus: SavingsGoalStatus;
  metrics: SavingsPlanMetrics;
  options: FinancialAdviceOption[];
  preferredOptionId: SavingsOptionId;
  explanation: FinancialAdviceExplanation;
  assumptions: string[];
  warnings: FinancialAdviceWarning[];
};

export type FinancialAdviceBudgetResponse = {
  schemaVersion: "1";
  kind: "BUDGET_BALANCE";
  currency: "VND";
  source: "USER_ENTERED";
  calculationVersion: string;
  catalogVersion: string;
  budgetStatus: BudgetStatus;
  savingsTargetStatus: BudgetSavingsTargetStatus;
  metrics: BudgetBalanceMetrics;
  options: FinancialAdviceOption[];
  preferredOptionId: BudgetOptionId;
  explanation: FinancialAdviceExplanation;
  assumptions: string[];
  warnings: FinancialAdviceWarning[];
};

export type FinancialAdviceResponse =
  | FinancialAdviceSavingsResponse
  | FinancialAdviceBudgetResponse;

export type AISelectorOutput = {
  preferredOptionId: FinancialOptionId;
  reasonIds: ReasonId[];
};
