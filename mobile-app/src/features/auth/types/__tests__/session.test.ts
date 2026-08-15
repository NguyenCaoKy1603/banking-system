import type { LoginResponse } from "@/features/auth/types/auth";
import {
  createAuthSession,
  isAccessTokenExpired,
} from "@/features/auth/types/session";

const loginResponse: LoginResponse = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresInSeconds: 900,
  user: {
    id: "user-id",
    fullName: "Người Dùng Thử",
    email: "tester@example.com",
    phoneNumber: "0912345678",
    createdAt: "2026-01-01T00:00:00Z",
  },
};

describe("AuthSession helpers", () => {
  it("tính accessTokenExpiresAt theo Unix timestamp millisecond", () => {
    const now = 1_700_000_000_000;

    const session = createAuthSession(loginResponse, now);

    expect(session.accessTokenExpiresAt).toBe(now + 900 * 1000);
    expect(session.accessToken).toBe(loginResponse.accessToken);
    expect(session.refreshToken).toBe(loginResponse.refreshToken);
    expect(session.user).toEqual(loginResponse.user);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "từ chối expiresInSeconds không hợp lệ: %s",
    (expiresInSeconds) => {
      expect(() =>
        createAuthSession({ ...loginResponse, expiresInSeconds }, 1_700_000_000_000),
      ).toThrow(RangeError);
    },
  );

  it("xác định token chưa hết hạn trước expiresAt", () => {
    const session = createAuthSession(loginResponse, 1_700_000_000_000);

    expect(isAccessTokenExpired(session, session.accessTokenExpiresAt - 1)).toBe(false);
  });

  it("xác định token hết hạn đúng tại expiresAt", () => {
    const session = createAuthSession(loginResponse, 1_700_000_000_000);

    expect(isAccessTokenExpired(session, session.accessTokenExpiresAt)).toBe(true);
  });

  it("xác định token hết hạn sau expiresAt", () => {
    const session = createAuthSession(loginResponse, 1_700_000_000_000);

    expect(isAccessTokenExpired(session, session.accessTokenExpiresAt + 1)).toBe(true);
  });
});
