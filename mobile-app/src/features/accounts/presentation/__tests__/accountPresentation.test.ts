import {
  getAccountNumberDisplay,
  getAccountStatusLabel,
} from "@/features/accounts/presentation/accountPresentation";

describe("account detail presentation", () => {
  it("maps backend account status to business labels", () => {
    expect(getAccountStatusLabel("ACTIVE")).toBe("Đang hoạt động");
    expect(getAccountStatusLabel("BLOCKED")).toBe("Đã khóa");
  });

  it("keeps the account number fully masked until the user taps show", () => {
    expect(getAccountNumberDisplay("•••• 0001", null, false)).toBe("•••• 0001");
    expect(getAccountNumberDisplay("•••• 0001", "970400000001", true)).toBe("970400000001");
  });
});
