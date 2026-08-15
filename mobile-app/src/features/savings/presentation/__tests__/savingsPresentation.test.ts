import {
  formatSavingsRate,
  getMaturityInstructionLabel,
  getSavingsDepositStatusLabel,
  getSavingsOpeningStatusLabel,
} from "@/features/savings/presentation/savingsPresentation";

describe("savings presentation", () => {
  it("keeps the server rate and status labels understandable", () => {
    expect(formatSavingsRate(450)).toBe("4.50%/năm");
    expect(getMaturityInstructionLabel("RENEW_PRINCIPAL")).toContain("Tái tục gốc");
    expect(getSavingsOpeningStatusLabel("PENDING")).toBe("Đang xử lý");
    expect(getSavingsDepositStatusLabel("ACTIVE")).toBe("Đang hoạt động");
  });
});
