import { isTerminalRefreshFailure } from "@/features/auth/domain/refreshFailure";
import { ApiError } from "@/services/api/ApiError";

describe("isTerminalRefreshFailure", () => {
  it("treats an unauthorized refresh as terminal", () => {
    expect(
      isTerminalRefreshFailure(
        new ApiError({
          status: 401,
          code: "UNAUTHORIZED",
          message: "Refresh token không hợp lệ.",
        }),
      ),
    ).toBe(true);
  });

  it.each([
    new ApiError({ status: null, code: "NETWORK_ERROR", message: "offline" }),
    new ApiError({ status: null, code: "TIMEOUT", message: "timeout" }),
    new ApiError({ status: 429, code: "RATE_LIMITED", message: "rate limited" }),
    new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "server" }),
    new Error("SecureStore failed"),
  ])("keeps the session for a transient failure", (error) => {
    expect(isTerminalRefreshFailure(error)).toBe(false);
  });
});
