import { formatVnd } from "./calculations.js";
import type {
  BudgetBalanceCalculations,
  SavingsPlanCalculations,
} from "./calculations.js";
import type {
  BudgetOptionId,
  FinancialAdviceOption,
  FinancialAdviceWarning,
  FinancialOptionId,
  FinancialPreference,
  ReasonId,
  SavingsOptionId,
} from "./types.js";

export function generateSavingsOptions(
  calc: SavingsPlanCalculations,
): FinancialAdviceOption[] {
  const { R, C, Q, J, V, H, F } = calc.raw;
  const suggestedMonths = calc.raw.suggestedMonths;
  const options: FinancialAdviceOption[] = [];

  if (R === 0n) {
    options.push({
      id: "GOAL_ALREADY_FUNDED",
      title: "Mục tiêu đã được tích lũy đủ",
      description: "Bạn đã có đủ số tiền cho mục tiêu theo số liệu đã nhập.",
      changes: {},
    });
    return options;
  }

  if (C >= Q) {
    options.push({
      id: "MAINTAIN_PLAN",
      title: "Giữ kế hoạch hiện tại",
      description: `Dành ${formatVnd(Q)} mỗi tháng. Khoản còn lại sau mục tiêu là ${formatVnd(C - Q)}.`,
      changes: {
        monthlySavingsMinor: Q.toString(),
        remainingBufferMinor: (C - Q).toString(),
      },
    });
    return options;
  }

  // GAP situation: C < Q and R > 0
  if (C > 0n && suggestedMonths !== null && BigInt(suggestedMonths) > H) {
    options.push({
      id: "EXTEND_DEADLINE",
      title: "Giữ mức chi, kéo dài thời hạn",
      description: `Theo số liệu đã nhập, cần khoảng ${suggestedMonths} tháng để dành phần còn thiếu.`,
      changes: {
        months: suggestedMonths,
      },
    });
  }

  if (J > 0n && J <= F) {
    options.push({
      id: "REDUCE_FLEXIBLE_SPENDING",
      title: "Giữ thời hạn, điều chỉnh chi phí linh hoạt",
      description: `Cân nhắc giảm ${formatVnd(J)} mỗi tháng từ khoản linh hoạt, nếu phù hợp hoàn cảnh.`,
      changes: {
        reductionMinor: J.toString(),
        newFlexibleExpensesMinor: (F - J).toString(),
      },
    });
  }

  if (C > 0n) {
    options.push({
      id: "LOWER_GOAL_AMOUNT",
      title: "Giữ thời hạn và mức chi, điều chỉnh mục tiêu",
      description: `Mức có thể dành theo kế hoạch hiện tại là ${formatVnd(V)}.`,
      changes: {
        targetAmountMinor: V.toString(),
      },
    });
  }

  if (C <= 0n || options.length === 0) {
    options.push({
      id: "REVIEW_BASE_BUDGET",
      title: "Rà soát lại thu nhập và các khoản chi",
      description:
        "Cân nhắc kiểm tra lại các khoản chi tiêu thiết yếu và nguồn thu để cải thiện khả năng tích lũy.",
      changes: {},
    });
  }

  return options;
}

export function generateBudgetOptions(
  calc: BudgetBalanceCalculations,
): FinancialAdviceOption[] {
  const { C, G, F, P, targetGap } = calc.raw;
  const options: FinancialAdviceOption[] = [];

  if (C >= G) {
    options.push({
      id: "MAINTAIN_BUDGET",
      title: "Duy trì ngân sách hiện tại",
      description: `Giữ mức chi hiện tại, dành ${formatVnd(G)} tiết kiệm. Phần còn lại sau mục tiêu là ${formatVnd(C - G)}.`,
      changes: {
        monthlySavingsTargetMinor: G.toString(),
        remainingAfterTargetMinor: (C - G).toString(),
      },
    });
    return options;
  }

  if (targetGap > 0n && targetGap <= F) {
    options.push({
      id: "REDUCE_FLEXIBLE_SPENDING",
      title: "Giữ mức tiết kiệm, điều chỉnh chi phí linh hoạt",
      description: `Cân nhắc giảm ${formatVnd(targetGap)} mỗi tháng từ khoản linh hoạt nếu phù hợp hoàn cảnh.`,
      changes: {
        reductionMinor: targetGap.toString(),
        newFlexibleExpensesMinor: (F - targetGap).toString(),
      },
    });
  }

  if (C >= 0n && C < G) {
    options.push({
      id: "ADJUST_SAVINGS_TARGET",
      title: "Giữ mức chi, điều chỉnh mức tiết kiệm",
      description: `Theo các khoản đã nhập, có thể dành ${formatVnd(P)} mỗi tháng sau khoản muốn giữ lại.`,
      changes: {
        monthlySavingsTargetMinor: P.toString(),
      },
    });
  }

  if (C < 0n || options.length === 0) {
    options.push({
      id: "REVIEW_BASE_BUDGET",
      title: "Rà soát lại thu nhập và các khoản chi",
      description:
        "Cân nhắc kiểm tra lại các khoản chi tiêu thiết yếu và nguồn thu để cân đối ngân sách cơ bản.",
      changes: {},
    });
  }

  return options;
}

export function generateSavingsWarnings(
  calc: SavingsPlanCalculations,
): FinancialAdviceWarning[] {
  const warnings: FinancialAdviceWarning[] = [];
  if (calc.budgetStatus === "DEFICIT") {
    warnings.push({
      code: "BASE_BUDGET_DEFICIT",
      message: `Ngân sách tháng đang thâm hụt ${formatVnd(calc.raw.baseDeficit)} trước khi tính mục tiêu tiết kiệm.`,
    });
  }
  if (calc.raw.bufferShortfall > 0n) {
    warnings.push({
      code: "BUFFER_NOT_COVERED",
      message: `Chưa bảo đảm đủ ${formatVnd(calc.raw.bufferShortfall)} cho khoản muốn giữ lại hàng tháng.`,
    });
  }
  return warnings;
}

export function generateBudgetWarnings(
  calc: BudgetBalanceCalculations,
): FinancialAdviceWarning[] {
  const warnings: FinancialAdviceWarning[] = [];
  if (calc.budgetStatus === "DEFICIT") {
    warnings.push({
      code: "BASE_BUDGET_DEFICIT",
      message: `Ngân sách tháng đang thâm hụt ${formatVnd(calc.raw.baseDeficit)}.`,
    });
  }
  if (calc.raw.bufferShortfall > 0n) {
    warnings.push({
      code: "BUFFER_NOT_COVERED",
      message: `Chưa bảo đảm đủ ${formatVnd(calc.raw.bufferShortfall)} cho khoản muốn giữ lại hàng tháng.`,
    });
  }
  return warnings;
}

export function getAllowedReasonIds(
  options: FinancialAdviceOption[],
  context: {
    isSavings: boolean;
    alreadyFunded: boolean;
    hasMonthlyGap: boolean;
    isFeasible: boolean;
    isBudgetMet: boolean;
    baseDeficit: boolean;
    bufferShortfall: boolean;
    noCapacity: boolean;
    preference: FinancialPreference;
  },
): ReasonId[] {
  const optionIds = new Set(options.map((o) => o.id));
  const reasons: ReasonId[] = [];

  if (context.alreadyFunded) {
    reasons.push("TARGET_ALREADY_FUNDED");
  }
  if (context.hasMonthlyGap) {
    reasons.push("MONTHLY_GAP");
  }
  if (context.isFeasible) {
    reasons.push("GOAL_FEASIBLE");
  }
  if (context.isBudgetMet) {
    reasons.push("BUDGET_TARGET_MET");
  }
  if (context.baseDeficit) {
    reasons.push("BASE_BUDGET_DEFICIT");
  }
  if (context.bufferShortfall) {
    reasons.push("BUFFER_NOT_COVERED");
  }
  if (context.noCapacity) {
    reasons.push("NO_SAVING_CAPACITY");
  }
  if (context.preference === "KEEP_CURRENT_SPENDING") {
    reasons.push("PRESERVE_CURRENT_SPENDING");
  }
  if (optionIds.has("REDUCE_FLEXIBLE_SPENDING")) {
    reasons.push("KEEP_TARGET_WITH_FLEXIBLE_CUT");
  }
  if (optionIds.has("LOWER_GOAL_AMOUNT") || optionIds.has("ADJUST_SAVINGS_TARGET")) {
    reasons.push("ADJUST_GOAL_TO_CAPACITY");
  }
  if (optionIds.has("EXTEND_DEADLINE")) {
    reasons.push("EXTEND_TIME_TO_CAPACITY");
  }
  if (optionIds.has("REVIEW_BASE_BUDGET")) {
    reasons.push("REVIEW_DECLARED_INPUTS");
  }

  return Array.from(new Set(reasons));
}

export function selectFallbackOption(
  options: FinancialAdviceOption[],
  preference: FinancialPreference,
  isSavings: boolean,
): FinancialOptionId {
  const ids = new Set(options.map((o) => o.id));

  // 1. Goal already funded
  if (ids.has("GOAL_ALREADY_FUNDED")) return "GOAL_ALREADY_FUNDED";

  // 2. Maintain plan or budget
  if (ids.has("MAINTAIN_PLAN")) return "MAINTAIN_PLAN";
  if (ids.has("MAINTAIN_BUDGET")) return "MAINTAIN_BUDGET";

  // 3. KEEP_TARGET + reduce flexible spending
  if (preference === "KEEP_TARGET" && ids.has("REDUCE_FLEXIBLE_SPENDING")) {
    return "REDUCE_FLEXIBLE_SPENDING";
  }

  // 4. KEEP_CURRENT_SPENDING
  if (preference === "KEEP_CURRENT_SPENDING") {
    if (isSavings) {
      if (ids.has("EXTEND_DEADLINE")) return "EXTEND_DEADLINE";
      if (ids.has("LOWER_GOAL_AMOUNT")) return "LOWER_GOAL_AMOUNT";
    } else {
      if (ids.has("ADJUST_SAVINGS_TARGET")) return "ADJUST_SAVINGS_TARGET";
    }
  }

  // 5. BALANCED
  if (preference === "BALANCED") {
    if (isSavings) {
      if (ids.has("EXTEND_DEADLINE")) return "EXTEND_DEADLINE";
      if (ids.has("LOWER_GOAL_AMOUNT")) return "LOWER_GOAL_AMOUNT";
      if (ids.has("REDUCE_FLEXIBLE_SPENDING")) return "REDUCE_FLEXIBLE_SPENDING";
    } else {
      if (ids.has("ADJUST_SAVINGS_TARGET")) return "ADJUST_SAVINGS_TARGET";
      if (ids.has("REDUCE_FLEXIBLE_SPENDING")) return "REDUCE_FLEXIBLE_SPENDING";
    }
  }

  // Default fallback if preference specific wasn't available
  if (ids.has("EXTEND_DEADLINE")) return "EXTEND_DEADLINE";
  if (ids.has("REDUCE_FLEXIBLE_SPENDING")) return "REDUCE_FLEXIBLE_SPENDING";
  if (ids.has("LOWER_GOAL_AMOUNT")) return "LOWER_GOAL_AMOUNT";
  if (ids.has("ADJUST_SAVINGS_TARGET")) return "ADJUST_SAVINGS_TARGET";
  if (ids.has("REVIEW_BASE_BUDGET")) return "REVIEW_BASE_BUDGET";

  return options[0].id;
}

export function selectFallbackReasons(
  preferredOptionId: FinancialOptionId,
  allowedReasons: ReasonId[],
  preference: FinancialPreference,
): ReasonId[] {
  const allowed = new Set(allowedReasons);
  const selected: ReasonId[] = [];

  // Add primary status reason
  if (allowed.has("TARGET_ALREADY_FUNDED")) {
    selected.push("TARGET_ALREADY_FUNDED");
  } else if (allowed.has("GOAL_FEASIBLE")) {
    selected.push("GOAL_FEASIBLE");
  } else if (allowed.has("BUDGET_TARGET_MET")) {
    selected.push("BUDGET_TARGET_MET");
  } else if (allowed.has("MONTHLY_GAP")) {
    selected.push("MONTHLY_GAP");
  } else if (allowed.has("NO_SAVING_CAPACITY")) {
    selected.push("NO_SAVING_CAPACITY");
  }

  // Add option/preference specific reason
  if (preferredOptionId === "REDUCE_FLEXIBLE_SPENDING" && allowed.has("KEEP_TARGET_WITH_FLEXIBLE_CUT")) {
    selected.push("KEEP_TARGET_WITH_FLEXIBLE_CUT");
  } else if (preferredOptionId === "EXTEND_DEADLINE") {
    if (preference === "KEEP_CURRENT_SPENDING" && allowed.has("PRESERVE_CURRENT_SPENDING")) {
      selected.push("PRESERVE_CURRENT_SPENDING");
    } else if (allowed.has("EXTEND_TIME_TO_CAPACITY")) {
      selected.push("EXTEND_TIME_TO_CAPACITY");
    }
  } else if (preferredOptionId === "LOWER_GOAL_AMOUNT" || preferredOptionId === "ADJUST_SAVINGS_TARGET") {
    if (preference === "KEEP_CURRENT_SPENDING" && allowed.has("PRESERVE_CURRENT_SPENDING")) {
      selected.push("PRESERVE_CURRENT_SPENDING");
    } else if (allowed.has("ADJUST_GOAL_TO_CAPACITY")) {
      selected.push("ADJUST_GOAL_TO_CAPACITY");
    }
  } else if (preferredOptionId === "REVIEW_BASE_BUDGET" && allowed.has("REVIEW_DECLARED_INPUTS")) {
    selected.push("REVIEW_DECLARED_INPUTS");
  }

  if (selected.length === 0 && allowedReasons.length > 0) {
    selected.push(allowedReasons[0]);
  }

  return selected.slice(0, 3);
}
