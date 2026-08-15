import { formatVndMinor } from "@/features/banking/presentation/formatMoney";

describe("formatVndMinor", () => {
  it("format số nguyên minor unit mà không dùng floating point", () => {
    expect(formatVndMinor("0")).toBe("0 ₫");
    expect(formatVndMinor("1000000")).toBe("1.000.000 ₫");
  });

  it("trả placeholder cho dữ liệu không hợp lệ", () => {
    expect(formatVndMinor("1.5")).toBe("—");
    expect(formatVndMinor("-1")).toBe("—");
  });
});
