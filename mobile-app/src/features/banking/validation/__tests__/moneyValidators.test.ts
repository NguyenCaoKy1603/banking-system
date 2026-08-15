import { isMoney } from "@/features/banking/validation/moneyValidators";

describe("moneyValidators", () => {
  it("từ chối floating point, số âm và currency khác VND", () => {
    expect(isMoney({ currency: "VND", amountMinor: "100.5" })).toBe(false);
    expect(isMoney({ currency: "VND", amountMinor: "-1" })).toBe(false);
    expect(isMoney({ currency: "USD", amountMinor: "100" })).toBe(false);
  });
});
