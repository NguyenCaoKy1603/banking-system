import { getBalanceDisplay } from "@/features/home/presentation/homePresentation";

describe("home presentation", () => {
  it("che số dư mặc định và chỉ format khi người dùng hiện số", () => {
    expect(getBalanceDisplay("10000000", false)).toBe("••• ••• ••• VND");
    expect(getBalanceDisplay("10000000", true)).toBe("10.000.000 ₫");
  });
});
