import type {
  BudgetBalanceMetrics,
  BudgetSavingsTargetStatus,
  BudgetStatus,
  FinancialAdviceBudgetRequest,
  FinancialAdviceSavingsRequest,
  SavingsGoalStatus,
  SavingsPlanMetrics,
} from "./types.js";

export function ceilDiv(x: bigint, y: bigint): bigint {
  if (y <= 0n) {
    throw new Error("Divisor must be strictly positive in ceilDiv.");
  }
  if (x <= 0n) {
    return 0n;
  }
  return (x + y - 1n) / y;
}

export function formatSignedMinor(value: bigint): string {
  if (value === 0n) return "0";
  return value.toString();
}

export function formatVnd(amountMinor: bigint): string {
  const isNegative = amountMinor < 0n;
  const absVal = isNegative ? -amountMinor : amountMinor;
  const parts: string[] = [];
  let s = absVal.toString();
  while (s.length > 3) {
    parts.unshift(s.slice(-3));
    s = s.slice(0, -3);
  }
  parts.unshift(s);
  return `${isNegative ? "-" : ""}${parts.join(".")} ₫`;
}

export type SavingsPlanCalculations = {
  budgetStatus: BudgetStatus;
  goalStatus: SavingsGoalStatus;
  metrics: SavingsPlanMetrics;
  raw: {
    I: bigint;
    E: bigint;
    F: bigint;
    D: bigint;
    B: bigint;
    T: bigint;
    A: bigint;
    H: bigint;
    M: bigint;
    S: bigint;
    C: bigint;
    P: bigint;
    R: bigint;
    Q: bigint;
    J: bigint;
    V: bigint;
    baseDeficit: bigint;
    bufferShortfall: bigint;
    suggestedMonths: number | null;
    horizonExceeded: boolean;
  };
};

export function calculateSavingsPlan(
  req: FinancialAdviceSavingsRequest,
): SavingsPlanCalculations {
  const I = BigInt(req.monthlyIncomeMinor);
  const E = BigInt(req.essentialExpensesMinor);
  const F = BigInt(req.flexibleExpensesMinor);
  const D = BigInt(req.monthlyDebtPaymentsMinor);
  const B = BigInt(req.monthlyBufferMinor);
  const T = BigInt(req.goal.targetAmountMinor);
  const A = BigInt(req.goal.alreadySavedMinor);
  const H = BigInt(req.goal.months);

  const M = E + F + D;
  const S = I - M;
  const C = S - B;
  const P = C > 0n ? C : 0n;
  const R = T > A ? T - A : 0n;
  const Q = R === 0n ? 0n : ceilDiv(R, H);
  const J = Q > C ? Q - C : 0n;
  const V = A + P * H;

  const baseDeficit = S < 0n ? -S : 0n;
  const maxUnallocated = S > 0n ? S : 0n;
  const bufferShortfall = B > maxUnallocated ? B - maxUnallocated : 0n;

  const budgetStatus: BudgetStatus =
    S < 0n ? "DEFICIT" : S === 0n ? "BALANCED" : "SURPLUS";

  let goalStatus: SavingsGoalStatus;
  if (R === 0n) {
    goalStatus = "ALREADY_FUNDED";
  } else if (C <= 0n) {
    goalStatus = "NO_CAPACITY";
  } else if (C >= Q) {
    goalStatus = "FEASIBLE";
  } else {
    goalStatus = "GAP";
  }

  let suggestedMonths: number | null = null;
  let horizonExceeded = false;

  if (R === 0n) {
    suggestedMonths = 0;
    horizonExceeded = false;
  } else if (C <= 0n) {
    suggestedMonths = null;
    horizonExceeded = false;
  } else {
    const H2 = ceilDiv(R, C);
    if (H2 <= 120n) {
      suggestedMonths = Number(H2);
      horizonExceeded = false;
    } else {
      suggestedMonths = null;
      horizonExceeded = true;
    }
  }

  const metrics: SavingsPlanMetrics = {
    declaredOutgoingsMinor: M.toString(),
    unallocatedBeforeBufferMinor: formatSignedMinor(S),
    capacityAfterBufferMinor: formatSignedMinor(C),
    bufferShortfallMinor: bufferShortfall.toString(),
    remainingGoalMinor: R.toString(),
    requiredMonthlySavingsMinor: Q.toString(),
    monthlyGapMinor: J.toString(),
    achievableGoalAtDeadlineMinor: V.toString(),
    suggestedMonths,
    horizonExceeded,
  };

  return {
    budgetStatus,
    goalStatus,
    metrics,
    raw: {
      I,
      E,
      F,
      D,
      B,
      T,
      A,
      H,
      M,
      S,
      C,
      P,
      R,
      Q,
      J,
      V,
      baseDeficit,
      bufferShortfall,
      suggestedMonths,
      horizonExceeded,
    },
  };
}

export type BudgetBalanceCalculations = {
  budgetStatus: BudgetStatus;
  savingsTargetStatus: BudgetSavingsTargetStatus;
  metrics: BudgetBalanceMetrics;
  raw: {
    I: bigint;
    E: bigint;
    F: bigint;
    D: bigint;
    B: bigint;
    G: bigint;
    M: bigint;
    S: bigint;
    C: bigint;
    P: bigint;
    targetGap: bigint;
    remainingAfterTarget: bigint;
    baseDeficit: bigint;
    bufferShortfall: bigint;
  };
};

export function calculateBudgetBalance(
  req: FinancialAdviceBudgetRequest,
): BudgetBalanceCalculations {
  const I = BigInt(req.monthlyIncomeMinor);
  const E = BigInt(req.essentialExpensesMinor);
  const F = BigInt(req.flexibleExpensesMinor);
  const D = BigInt(req.monthlyDebtPaymentsMinor);
  const B = BigInt(req.monthlyBufferMinor);
  const G = BigInt(req.monthlySavingsTargetMinor);

  const M = E + F + D;
  const S = I - M;
  const C = S - B;
  const P = C > 0n ? C : 0n;
  const targetGap = G > C ? G - C : 0n;
  const remainingAfterTarget = C - G;

  const baseDeficit = S < 0n ? -S : 0n;
  const maxUnallocated = S > 0n ? S : 0n;
  const bufferShortfall = B > maxUnallocated ? B - maxUnallocated : 0n;

  const budgetStatus: BudgetStatus =
    S < 0n ? "DEFICIT" : S === 0n ? "BALANCED" : "SURPLUS";

  const savingsTargetStatus: BudgetSavingsTargetStatus =
    C >= G ? "MET" : "GAP";

  const metrics: BudgetBalanceMetrics = {
    declaredOutgoingsMinor: M.toString(),
    unallocatedBeforeBufferMinor: formatSignedMinor(S),
    capacityAfterBufferMinor: formatSignedMinor(C),
    maximumSavingsAtCurrentBudgetMinor: P.toString(),
    targetGapMinor: targetGap.toString(),
    remainingAfterTargetMinor: formatSignedMinor(remainingAfterTarget),
    baseDeficitMinor: baseDeficit.toString(),
    bufferShortfallMinor: bufferShortfall.toString(),
  };

  return {
    budgetStatus,
    savingsTargetStatus,
    metrics,
    raw: {
      I,
      E,
      F,
      D,
      B,
      G,
      M,
      S,
      C,
      P,
      targetGap,
      remainingAfterTarget,
      baseDeficit,
      bufferShortfall,
    },
  };
}
