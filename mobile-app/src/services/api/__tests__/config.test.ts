let resolveApiUrl: typeof import("@/services/api/config").resolveApiUrl;
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
const originalSandboxFlag = process.env.EXPO_PUBLIC_SANDBOX_HTTP;

beforeAll(() => {
  process.env.EXPO_PUBLIC_API_URL = "http://10.0.2.2:5000/api/v1";
  process.env.EXPO_PUBLIC_SANDBOX_HTTP = "1";
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra: { runtimeEnvironment: "local-sandbox" } } },
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  resolveApiUrl = require("@/services/api/config").resolveApiUrl;
});

afterAll(() => {
  if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  if (originalSandboxFlag === undefined) delete process.env.EXPO_PUBLIC_SANDBOX_HTTP;
  else process.env.EXPO_PUBLIC_SANDBOX_HTTP = originalSandboxFlag;
  jest.dontMock("expo-constants");
  jest.resetModules();
});

describe("api config", () => {
  it("dùng HTTP loopback cho Android sandbox local khi bật cờ rõ ràng", () => {
    expect(resolveApiUrl(undefined, true, true, "android", "local-sandbox")).toBe(
      "http://10.0.2.2:5000/api/v1",
    );
  });

  it("dùng localhost cho Web khi cấu hình đang dùng host alias của Android emulator", () => {
    expect(resolveApiUrl(undefined, true, true, "web", "local-sandbox")).toBe(
      "http://localhost:5000/api/v1",
    );
    expect(
      resolveApiUrl("http://10.0.2.2:5000/api/v1", true, true, "web", "local-sandbox"),
    ).toBe("http://localhost:5000/api/v1");
  });

  it("giữ nguyên host cho HTTPS trên Web và native", () => {
    expect(
      resolveApiUrl("https://api.example.com/api/v1", false, false, "android", "staging"),
    ).toBe("https://api.example.com/api/v1");
    expect(
      resolveApiUrl("https://api.example.com/api/v1", false, false, "web", "production"),
    ).toBe("https://api.example.com/api/v1");
  });

  it("fail closed khi production thiếu API URL", () => {
    expect(() => resolveApiUrl(undefined, true, false, "android", "production")).toThrow(
      "EXPO_PUBLIC_API_URL phải được cấu hình cho bản production.",
    );
  });

  it("từ chối HTTP ở staging dù cờ sandbox được tắt", () => {
    expect(() => resolveApiUrl("http://api.example.com/api/v1", true, false, "android", "staging")).toThrow(
      "HTTP chỉ được dùng với API local khi bật cờ sandbox local.",
    );
  });

  it("từ chối cờ sandbox ở staging kể cả khi API URL là HTTPS", () => {
    expect(
      () => resolveApiUrl("https://api.example.com/api/v1", true, true, "android", "staging"),
    ).toThrow("EXPO_PUBLIC_SANDBOX_HTTP chỉ được bật cho bản sandbox local.");
  });

  it("cho phép release APK local sandbox đi tới emulator loopback", () => {
    expect(resolveApiUrl("http://10.0.2.2:5000/api/v1", true, true, "android", "local-sandbox")).toBe(
      "http://10.0.2.2:5000/api/v1",
    );
  });

  it("từ chối HTTP ra máy chủ không phải local trong sandbox", () => {
    expect(() => resolveApiUrl("http://api.example.com/api/v1", false, true, "android", "local-sandbox")).toThrow(
      "HTTP chỉ được dùng với API local khi bật cờ sandbox local.",
    );
  });

  it("từ chối bật cleartext flag khi endpoint đã dùng HTTPS", () => {
    expect(() => resolveApiUrl("https://api.example.com/api/v1", false, true, "android", "local-sandbox")).toThrow(
      "Tắt EXPO_PUBLIC_SANDBOX_HTTP khi API URL đã dùng HTTPS.",
    );
  });

  it("chuẩn hóa URL HTTPS hợp lệ", () => {
    expect(resolveApiUrl(" https://api.example.com/api/v1/// ", true, false, "android", "production")).toBe(
      "https://api.example.com/api/v1",
    );
  });

  it("từ chối scheme không phải HTTP(S)", () => {
    expect(() => resolveApiUrl("ftp://api.example.com", false)).toThrow(
      "EXPO_PUBLIC_API_URL phải là một URL HTTP hợp lệ.",
    );
  });
});
