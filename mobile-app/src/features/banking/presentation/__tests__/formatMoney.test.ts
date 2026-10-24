import { formatVndMinor, formatVndWords } from "@/features/banking/presentation/formatMoney";

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

describe("formatVndWords", () => {
  it("chuyển đổi số tiền thành chữ tiếng Việt chuẩn xác", () => {
    expect(formatVndWords("50000")).toBe("Năm mươi nghìn đồng");
    expect(formatVndWords("100000")).toBe("Một trăm nghìn đồng");
    expect(formatVndWords("1000000")).toBe("Một triệu đồng");
    expect(formatVndWords("1500000")).toBe("Một triệu năm trăm nghìn đồng");
    expect(formatVndWords("10000000")).toBe("Mười triệu đồng");
    expect(formatVndWords("50000000")).toBe("Năm mươi triệu đồng");
  });

  it("trả về chuỗi rỗng cho giá trị không hợp lệ hoặc bằng 0", () => {
    expect(formatVndWords("0")).toBe("");
    expect(formatVndWords("-50000")).toBe("");
    expect(formatVndWords("abc")).toBe("");
  });
});

