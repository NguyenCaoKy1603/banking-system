import { resolveApiUrl } from "@/services/api/config";

describe("api config", () => {
  it("dùng emulator URL mặc định ngoài production", () => {
    expect(resolveApiUrl(undefined, false, false, "android")).toBe("http://10.0.2.2:5000/api/v1");
  });

  it("dùng localhost cho Web khi cấu hình đang dùng host alias của Android emulator", () => {
    expect(resolveApiUrl(undefined, false, false, "web")).toBe("http://localhost:5000/api/v1");
    expect(
      resolveApiUrl("http://10.0.2.2:5000/api/v1", false, false, "web"),
    ).toBe("http://localhost:5000/api/v1");
    expect(
      resolveApiUrl("http://10.0.2.2:5000/api/v1", true, true, "web"),
    ).toBe("http://localhost:5000/api/v1");
  });

  it("giữ nguyên host do người dùng cấu hình cho API ngoài localhost và native", () => {
    expect(
      resolveApiUrl("http://10.0.2.2:5000/api/v1", false, false, "android"),
    ).toBe("http://10.0.2.2:5000/api/v1");
    expect(
      resolveApiUrl("https://api.example.com/api/v1", false, false, "web"),
    ).toBe("https://api.example.com/api/v1");
  });

  it("fail closed khi production thiếu API URL", () => {
    expect(() => resolveApiUrl(undefined, true)).toThrow(
      "EXPO_PUBLIC_API_URL phải được cấu hình cho bản production.",
    );
  });

  it("fail closed khi production dùng HTTP", () => {
    expect(() => resolveApiUrl("http://api.example.com/api/v1", true)).toThrow(
      "Bản production chỉ được gọi API qua HTTPS.",
    );
  });

  it("chỉ cho phép HTTP khi bật rõ sandbox device", () => {
    expect(
      resolveApiUrl("http://10.0.2.2:5000/api/v1", true, true),
    ).toBe("http://10.0.2.2:5000/api/v1");
  });

  it("chuẩn hóa URL hợp lệ và giữ HTTPS ở production", () => {
    expect(resolveApiUrl(" https://api.example.com/api/v1/// ", true)).toBe(
      "https://api.example.com/api/v1",
    );
  });

  it("từ chối scheme không phải HTTP(S)", () => {
    expect(() => resolveApiUrl("ftp://api.example.com", false)).toThrow(
      "EXPO_PUBLIC_API_URL phải là một URL HTTP hợp lệ.",
    );
  });
});
