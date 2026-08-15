import type { SavingsOpeningStatus } from "@/features/savings/types/savings";

export type SavingsOpeningStep = "input" | "review" | "stepUp" | "result";

export function canRetrySavingsOpening(status: SavingsOpeningStatus): boolean {
  return status === "PENDING";
}

export function isTerminalSavingsOpeningStatus(
  status: SavingsOpeningStatus,
): boolean {
  return status !== "PENDING";
}

export function nextSavingsOpeningStep(
  current: SavingsOpeningStep,
  action: "QUOTE" | "CONFIRM" | "SUBMIT" | "RESULT",
): SavingsOpeningStep {
  if (action === "QUOTE" && current === "input") {
    return "review";
  }
  if (action === "CONFIRM" && current === "review") {
    return "stepUp";
  }
  if (action === "SUBMIT" && current === "stepUp") {
    return "result";
  }
  if (action === "RESULT") {
    return "result";
  }
  return current;
}
