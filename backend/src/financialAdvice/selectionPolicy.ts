import type {
  FinancialAdviceOption,
  FinancialAdviceRequest,
  FinancialOptionId,
  ReasonId,
} from "./types.js";

export const FINANCIAL_ADVICE_POLICY_VERSION = "fa-selection-v2";

export type SelectionPolicy = {
  policyVersion: typeof FINANCIAL_ADVICE_POLICY_VERSION;
  eligiblePreferredOptionIds: FinancialOptionId[];
  allowedReasonIdsByOption: Partial<Record<FinancialOptionId, ReasonId[]>>;
  primaryReasonIdsByOption: Partial<Record<FinancialOptionId, ReasonId[]>>;
};

export type SelectionPolicyFacts = {
  alreadyFunded: boolean;
  isFeasible: boolean;
  isBudgetMet: boolean;
  hasMonthlyGap: boolean;
  baseDeficit: boolean;
  bufferShortfall: boolean;
  noCapacity: boolean;
};

function candidateIds(options: FinancialAdviceOption[]): FinancialOptionId[] {
  return options.map((option) => option.id);
}

function eligibleOptions(
  request: FinancialAdviceRequest,
  ids: FinancialOptionId[],
  facts: SelectionPolicyFacts,
): FinancialOptionId[] {
  const has = (id: FinancialOptionId) => ids.includes(id);
  if (facts.alreadyFunded && has("GOAL_ALREADY_FUNDED")) return ["GOAL_ALREADY_FUNDED"];
  if (facts.isFeasible && has("MAINTAIN_PLAN")) return ["MAINTAIN_PLAN"];
  if (facts.isBudgetMet && has("MAINTAIN_BUDGET")) return ["MAINTAIN_BUDGET"];

  if (request.preference === "KEEP_TARGET") {
    if (has("REDUCE_FLEXIBLE_SPENDING")) return ["REDUCE_FLEXIBLE_SPENDING"];
    if (request.kind === "SAVINGS_PLAN" && has("EXTEND_DEADLINE")) return ["EXTEND_DEADLINE"];
    if (has("REVIEW_BASE_BUDGET")) return ["REVIEW_BASE_BUDGET"];
    if (request.kind === "SAVINGS_PLAN" && has("LOWER_GOAL_AMOUNT")) return ["LOWER_GOAL_AMOUNT"];
    if (has("ADJUST_SAVINGS_TARGET")) return ["ADJUST_SAVINGS_TARGET"];
  }

  if (request.preference === "KEEP_CURRENT_SPENDING") {
    if (facts.noCapacity && has("REVIEW_BASE_BUDGET")) return ["REVIEW_BASE_BUDGET"];
    const preserveSpending = ids.filter((id) => id !== "REDUCE_FLEXIBLE_SPENDING");
    if (request.kind === "SAVINGS_PLAN") {
      const preferred = preserveSpending.filter((id) =>
        id === "EXTEND_DEADLINE" || id === "LOWER_GOAL_AMOUNT" || id === "REVIEW_BASE_BUDGET",
      );
      if (preferred.length) return preferred;
    } else {
      const preferred = preserveSpending.filter((id) =>
        id === "ADJUST_SAVINGS_TARGET" || id === "REVIEW_BASE_BUDGET",
      );
      if (preferred.length) return preferred;
    }
    // A cut is allowed only if no feasible candidate preserves current spending.
    return ids;
  }

  if (facts.noCapacity && has("REVIEW_BASE_BUDGET")) return ["REVIEW_BASE_BUDGET"];
  if (request.kind === "SAVINGS_PLAN") {
    return ids.filter((id) =>
      id === "EXTEND_DEADLINE" || id === "REDUCE_FLEXIBLE_SPENDING" ||
      id === "LOWER_GOAL_AMOUNT" || id === "REVIEW_BASE_BUDGET",
    );
  }
  return ids.filter((id) =>
    id === "ADJUST_SAVINGS_TARGET" || id === "REDUCE_FLEXIBLE_SPENDING" || id === "REVIEW_BASE_BUDGET",
  );
}

export function buildSelectionPolicy(
  request: FinancialAdviceRequest,
  options: FinancialAdviceOption[],
  facts: SelectionPolicyFacts,
): SelectionPolicy {
  const ids = candidateIds(options);
  const eligiblePreferredOptionIds = eligibleOptions(request, ids, facts);
  const allowedReasonIdsByOption: SelectionPolicy["allowedReasonIdsByOption"] = {};
  const primaryReasonIdsByOption: SelectionPolicy["primaryReasonIdsByOption"] = {};

  for (const option of options) {
    const allowed = new Set<ReasonId>();
    const primary = new Set<ReasonId>();
    const id = option.id;

    if (facts.baseDeficit) allowed.add("BASE_BUDGET_DEFICIT");
    if (facts.bufferShortfall) allowed.add("BUFFER_NOT_COVERED");

    switch (id) {
      case "GOAL_ALREADY_FUNDED":
        if (request.kind === "SAVINGS_PLAN" && facts.alreadyFunded) {
          allowed.add("TARGET_ALREADY_FUNDED");
          primary.add("TARGET_ALREADY_FUNDED");
        }
        break;
      case "MAINTAIN_PLAN":
        if (request.kind === "SAVINGS_PLAN" && facts.isFeasible) {
          allowed.add("GOAL_FEASIBLE");
          primary.add("GOAL_FEASIBLE");
        }
        break;
      case "MAINTAIN_BUDGET":
        if (request.kind === "BUDGET_BALANCE" && facts.isBudgetMet) {
          allowed.add("BUDGET_TARGET_MET");
          primary.add("BUDGET_TARGET_MET");
        }
        break;
      case "EXTEND_DEADLINE":
        if (request.kind === "SAVINGS_PLAN" && facts.hasMonthlyGap) {
          allowed.add("MONTHLY_GAP");
          primary.add("MONTHLY_GAP");
        }
        if (option.changes.months && Number(option.changes.months) <= 120) {
          allowed.add("EXTEND_TIME_TO_CAPACITY");
        }
        break;
      case "REDUCE_FLEXIBLE_SPENDING":
        if (facts.hasMonthlyGap) {
          allowed.add("MONTHLY_GAP");
          primary.add("MONTHLY_GAP");
        }
        if (request.preference === "KEEP_TARGET") {
          allowed.add("KEEP_TARGET_WITH_FLEXIBLE_CUT");
        }
        break;
      case "LOWER_GOAL_AMOUNT":
      case "ADJUST_SAVINGS_TARGET":
        if (facts.hasMonthlyGap) {
          allowed.add("MONTHLY_GAP");
          primary.add("MONTHLY_GAP");
        }
        allowed.add("ADJUST_GOAL_TO_CAPACITY");
        break;
      case "REVIEW_BASE_BUDGET":
        allowed.add("REVIEW_DECLARED_INPUTS");
        if (facts.noCapacity) allowed.add("NO_SAVING_CAPACITY");
        if (facts.baseDeficit) primary.add("BASE_BUDGET_DEFICIT");
        else if (facts.noCapacity) primary.add("NO_SAVING_CAPACITY");
        else primary.add("REVIEW_DECLARED_INPUTS");
        break;
    }

    if (
      request.preference === "KEEP_CURRENT_SPENDING" &&
      id !== "REDUCE_FLEXIBLE_SPENDING"
    ) {
      allowed.add("PRESERVE_CURRENT_SPENDING");
    }

    allowedReasonIdsByOption[id] = [...allowed];
    primaryReasonIdsByOption[id] = [...primary];
  }

  return {
    policyVersion: FINANCIAL_ADVICE_POLICY_VERSION,
    eligiblePreferredOptionIds,
    allowedReasonIdsByOption,
    primaryReasonIdsByOption,
  };
}

export function isSelectionAllowed(
  policy: SelectionPolicy,
  preferredOptionId: string,
  reasonIds: readonly string[],
): boolean {
  if (!policy.eligiblePreferredOptionIds.includes(preferredOptionId as FinancialOptionId)) return false;
  if (reasonIds.length < 1 || reasonIds.length > 3 || new Set(reasonIds).size !== reasonIds.length) return false;
  const optionId = preferredOptionId as FinancialOptionId;
  const allowed = new Set(policy.allowedReasonIdsByOption[optionId] ?? []);
  if (reasonIds.some((reason) => !allowed.has(reason as ReasonId))) return false;
  const primary = policy.primaryReasonIdsByOption[optionId] ?? [];
  return primary.some((reason) => reasonIds.includes(reason));
}

export function selectFallbackOption(
  policy: SelectionPolicy,
  preference: FinancialAdviceRequest["preference"],
  kind: FinancialAdviceRequest["kind"],
): FinancialOptionId {
  const eligible = new Set(policy.eligiblePreferredOptionIds);
  const rank: FinancialOptionId[] = [
    "GOAL_ALREADY_FUNDED", "MAINTAIN_PLAN", "MAINTAIN_BUDGET",
  ];
  if (preference === "KEEP_TARGET") {
    rank.push("REDUCE_FLEXIBLE_SPENDING", "EXTEND_DEADLINE", "REVIEW_BASE_BUDGET", "LOWER_GOAL_AMOUNT", "ADJUST_SAVINGS_TARGET");
  } else if (preference === "KEEP_CURRENT_SPENDING") {
    rank.push("EXTEND_DEADLINE", "LOWER_GOAL_AMOUNT", "ADJUST_SAVINGS_TARGET", "REVIEW_BASE_BUDGET", "REDUCE_FLEXIBLE_SPENDING");
  } else if (kind === "SAVINGS_PLAN") {
    rank.push("REVIEW_BASE_BUDGET", "EXTEND_DEADLINE", "REDUCE_FLEXIBLE_SPENDING", "LOWER_GOAL_AMOUNT");
  } else {
    rank.push("REVIEW_BASE_BUDGET", "ADJUST_SAVINGS_TARGET", "REDUCE_FLEXIBLE_SPENDING");
  }
  const selected = rank.find((id) => eligible.has(id));
  if (selected) return selected;
  throw new Error("Financial advice selection policy has no eligible candidate.");
}

export function selectFallbackReasons(
  policy: SelectionPolicy,
  preferredOptionId: FinancialOptionId,
): ReasonId[] {
  const allowed = policy.allowedReasonIdsByOption[preferredOptionId] ?? [];
  const primary = policy.primaryReasonIdsByOption[preferredOptionId] ?? [];
  const selected: ReasonId[] = [];
  const add = (reason: ReasonId) => {
    if (allowed.includes(reason) && !selected.includes(reason) && selected.length < 3) selected.push(reason);
  };
  for (const reason of primary) add(reason);
  for (const reason of [
    "EXTEND_TIME_TO_CAPACITY", "KEEP_TARGET_WITH_FLEXIBLE_CUT", "ADJUST_GOAL_TO_CAPACITY",
    "PRESERVE_CURRENT_SPENDING", "REVIEW_DECLARED_INPUTS", "BASE_BUDGET_DEFICIT",
    "BUFFER_NOT_COVERED", "NO_SAVING_CAPACITY",
  ] as const) add(reason);
  if (!isSelectionAllowed(policy, preferredOptionId, selected)) {
    throw new Error("Financial advice fallback violates the selection policy.");
  }
  return selected;
}
