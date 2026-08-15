import {
  canRetrySavingsOpening,
  isTerminalSavingsOpeningStatus,
  nextSavingsOpeningStep,
} from "@/features/savings/domain/savingsOpeningStateMachine";

describe("savings opening state machine", () => {
  it("moves through quote, review, MFA and result steps", () => {
    expect(nextSavingsOpeningStep("input", "QUOTE")).toBe("review");
    expect(nextSavingsOpeningStep("review", "CONFIRM")).toBe("stepUp");
    expect(nextSavingsOpeningStep("stepUp", "SUBMIT")).toBe("result");
  });

  it("keeps invalid transitions stable and allows retry only for pending", () => {
    expect(nextSavingsOpeningStep("input", "SUBMIT")).toBe("input");
    expect(canRetrySavingsOpening("PENDING")).toBe(true);
    expect(canRetrySavingsOpening("SUCCEEDED")).toBe(false);
    expect(isTerminalSavingsOpeningStatus("PENDING")).toBe(false);
    expect(isTerminalSavingsOpeningStatus("FAILED")).toBe(true);
  });
});
