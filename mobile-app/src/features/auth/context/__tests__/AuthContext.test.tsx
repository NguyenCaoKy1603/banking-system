import { createElement, useEffect } from "react";
import {
  act,
  create,
  type ReactTestRenderer,
} from "react-test-renderer";
import { AppState } from "react-native";

import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import {
  refreshSession as refreshSessionRequest,
  revokeAllSessions,
  revokeSession,
} from "@/features/auth/services/authApi";
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from "@/features/auth/storage/authSessionStorage";
import { loadDeviceBindingId } from "@/features/auth/storage/deviceBindingStorage";
import type { LoginResponse } from "@/features/auth/types/auth";
import type { AuthSession } from "@/features/auth/types/session";
import { clearTransferIntent } from "@/features/transfers/storage/transferIntentStorage";
import { clearSavingsIntent } from "@/features/savings/storage/savingsIntentStorage";
import { clearCardPaymentIntentsForUser } from "@/features/credit/storage/cardPaymentIntentStorage";
import { clearFraudReportIntentsForUser } from "@/features/fraud/storage/fraudReportIntentStorage";

jest.mock("@/features/auth/services/authApi", () => ({
  login: jest.fn(),
  refreshSession: jest.fn(),
  register: jest.fn(),
  resendRegistrationChallenge: jest.fn(),
  revokeAllSessions: jest.fn(),
  revokeSession: jest.fn(),
  verifyRegistrationChallenge: jest.fn(),
}));
jest.mock("@/features/auth/storage/authSessionStorage", () => ({
  clearAuthSession: jest.fn(),
  loadAuthSession: jest.fn(),
  saveAuthSession: jest.fn(),
}));
jest.mock("@/features/auth/storage/deviceBindingStorage", () => ({
  loadDeviceBindingId: jest.fn(),
}));
jest.mock("@/features/transfers/storage/transferIntentStorage", () => ({
  clearTransferIntent: jest.fn(),
}));
jest.mock("@/features/savings/storage/savingsIntentStorage", () => ({
  clearSavingsIntent: jest.fn(),
}));
jest.mock("@/features/credit/storage/cardPaymentIntentStorage", () => ({
  clearCardPaymentIntentsForUser: jest.fn(),
}));
jest.mock("@/features/fraud/storage/fraudReportIntentStorage", () => ({
  clearFraudReportIntentsForUser: jest.fn(),
}));

const storedSession: AuthSession = {
  accessToken: "access-token-1",
  refreshToken: "refresh-token-1",
  accessTokenExpiresAt: 1_900_000_000_000,
  sessionEpoch: "session-epoch-1",
  user: {
    id: "user-id",
    fullName: "Người Dùng Thử",
    email: "tester@example.com",
    phoneNumber: "0912345678",
    createdAt: "2026-01-01T00:00:00Z",
  },
};
const refreshedResponse: LoginResponse = {
  accessToken: "access-token-2",
  refreshToken: "refresh-token-2",
  expiresInSeconds: 900,
  user: storedSession.user,
};
const logoutRefreshResponse: LoginResponse = {
  accessToken: "access-token-3",
  refreshToken: "refresh-token-3",
  expiresInSeconds: 900,
  user: storedSession.user,
};

const refreshSessionRequestMock = jest.mocked(refreshSessionRequest);
const revokeAllSessionsMock = jest.mocked(revokeAllSessions);
const revokeSessionMock = jest.mocked(revokeSession);
const clearAuthSessionMock = jest.mocked(clearAuthSession);
const loadAuthSessionMock = jest.mocked(loadAuthSession);
const saveAuthSessionMock = jest.mocked(saveAuthSession);
const loadDeviceBindingIdMock = jest.mocked(loadDeviceBindingId);
const clearTransferIntentMock = jest.mocked(clearTransferIntent);
const clearSavingsIntentMock = jest.mocked(clearSavingsIntent);
const clearCardPaymentIntentsForUserMock = jest.mocked(
  clearCardPaymentIntentsForUser,
);
const clearFraudReportIntentsForUserMock = jest.mocked(
  clearFraudReportIntentsForUser,
);

let latestAuth: ReturnType<typeof useAuth> | null = null;
let renderer: ReactTestRenderer | null = null;

type AuthValue = ReturnType<typeof useAuth>;

function captureAuth(value: AuthValue) {
  latestAuth = value;
}

function Probe({ onChange }: { onChange: (value: AuthValue) => void }) {
  const auth = useAuth();
  useEffect(() => onChange(auth), [auth, onChange]);
  return null;
}

function getAuth(): ReturnType<typeof useAuth> {
  if (!latestAuth) {
    throw new Error("Auth context has not rendered.");
  }
  return latestAuth;
}

function createDeferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function renderProvider() {
  await act(async () => {
    renderer = create(
      createElement(
        AuthProvider,
        null,
        createElement(Probe, { onChange: captureAuth }),
      ),
    );
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }
  });
}

beforeAll(() => {
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: "active",
  });
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.clearAllMocks();
  latestAuth = null;
  renderer = null;
  loadDeviceBindingIdMock.mockResolvedValue("device-id");
  loadAuthSessionMock.mockResolvedValue(storedSession);
  saveAuthSessionMock.mockResolvedValue(undefined);
  clearAuthSessionMock.mockResolvedValue(undefined);
  clearTransferIntentMock.mockResolvedValue(undefined);
  clearSavingsIntentMock.mockResolvedValue(undefined);
  clearCardPaymentIntentsForUserMock.mockResolvedValue(undefined);
  clearFraudReportIntentsForUserMock.mockResolvedValue(undefined);
  revokeSessionMock.mockResolvedValue(undefined);
  revokeAllSessionsMock.mockResolvedValue(undefined);
});

afterEach(() => {
  if (renderer) {
    act(() => renderer?.unmount());
  }
  expect(clearTransferIntentMock).not.toHaveBeenCalled();
  expect(clearSavingsIntentMock).not.toHaveBeenCalled();
  expect(clearCardPaymentIntentsForUserMock).not.toHaveBeenCalled();
  expect(clearFraudReportIntentsForUserMock).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

describe("AuthProvider logout coordination", () => {
  it("vô hiệu hóa epoch trước khi chờ refresh và thu hồi token đã xoay vòng", async () => {
    const refreshDeferred = createDeferred<LoginResponse>();
    refreshSessionRequestMock.mockReturnValue(refreshDeferred.promise);
    await renderProvider();

    expect(refreshSessionRequestMock).toHaveBeenCalledTimes(1);
    expect(getAuth().status).toBe("refreshing");
    const staleRefreshAccessToken = getAuth().refreshAccessToken;

    let logoutPromise!: ReturnType<ReturnType<typeof useAuth>["logout"]>;
    act(() => {
      logoutPromise = getAuth().logout();
    });

    expect(getAuth().status).toBe("loggingOut");
    expect(getAuth().session).toBeNull();
    expect(clearAuthSessionMock).not.toHaveBeenCalled();
    await expect(staleRefreshAccessToken()).resolves.toBeNull();
    expect(refreshSessionRequestMock).toHaveBeenCalledTimes(1);

    let result!: Awaited<typeof logoutPromise>;
    await act(async () => {
      refreshDeferred.resolve(refreshedResponse);
      result = await logoutPromise;
    });

    expect(saveAuthSessionMock).not.toHaveBeenCalled();
    expect(revokeSessionMock).toHaveBeenCalledWith("refresh-token-2", {
      deviceId: "device-id",
    });
    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(revokeSessionMock.mock.invocationCallOrder[0]).toBeLessThan(
      clearAuthSessionMock.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(clearTransferIntentMock).not.toHaveBeenCalled();
    expect(clearSavingsIntentMock).not.toHaveBeenCalled();
    expect(clearCardPaymentIntentsForUserMock).not.toHaveBeenCalled();
    expect(clearFraudReportIntentsForUserMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      localSessionCleared: true,
      remoteRevoked: true,
      recoveryIntentsPreserved: true,
    });
    expect(getAuth().status).toBe("anonymous");
    await expect(staleRefreshAccessToken()).resolves.toBeNull();
    expect(refreshSessionRequestMock).toHaveBeenCalledTimes(1);
  });

  it("luôn về anonymous, phản ánh lỗi session/remote và giữ recovery intent", async () => {
    refreshSessionRequestMock.mockResolvedValue(refreshedResponse);
    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getAuth().status).toBe("authenticated");
    revokeAllSessionsMock.mockRejectedValueOnce(new Error("remote offline"));
    clearAuthSessionMock.mockImplementationOnce(() => {
      throw new Error("secure store unavailable");
    });
    let result!: Awaited<ReturnType<ReturnType<typeof useAuth>["logoutAll"]>>;
    await act(async () => {
      result = await getAuth().logoutAll();
    });

    expect(result).toEqual({
      localSessionCleared: false,
      remoteRevoked: false,
      recoveryIntentsPreserved: true,
    });
    expect(revokeAllSessionsMock).toHaveBeenCalledWith({
      accessToken: "access-token-2",
      deviceId: "device-id",
    });
    expect(clearTransferIntentMock).not.toHaveBeenCalled();
    expect(clearSavingsIntentMock).not.toHaveBeenCalled();
    expect(clearCardPaymentIntentsForUserMock).not.toHaveBeenCalled();
    expect(clearFraudReportIntentsForUserMock).not.toHaveBeenCalled();
    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().session).toBeNull();
    expect(getAuth().logoutNotice).toContain(
      "chưa xóa được thông tin đăng nhập lưu trên thiết bị",
    );
    expect(getAuth().logoutNotice).toContain(
      "chưa thể xác nhận đăng xuất các thiết bị khác",
    );
  });

  it("không khôi phục lại phiên nếu SecureStore trả về sau khi logout đã bắt đầu", async () => {
    const loadDeferred = createDeferred<AuthSession | null>();
    loadAuthSessionMock.mockReturnValue(loadDeferred.promise);
    await renderProvider();

    expect(getAuth().status).toBe("booting");
    let logoutPromise!: ReturnType<ReturnType<typeof useAuth>["logout"]>;
    act(() => {
      logoutPromise = getAuth().logout();
    });
    expect(getAuth().status).toBe("loggingOut");

    await act(async () => {
      await logoutPromise;
    });
    expect(getAuth().status).toBe("anonymous");

    await act(async () => {
      loadDeferred.resolve(storedSession);
      await Promise.resolve();
    });

    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().session).toBeNull();
    expect(refreshSessionRequestMock).not.toHaveBeenCalled();
  });

  it("refresh một lần để logout-all khi access token hết hạn mà không lưu phiên xoay vòng", async () => {
    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValue(1_700_000_000_000);
    refreshSessionRequestMock
      .mockResolvedValueOnce(refreshedResponse)
      .mockResolvedValueOnce(logoutRefreshResponse);
    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getAuth().status).toBe("authenticated");

    saveAuthSessionMock.mockClear();
    nowSpy.mockReturnValue(1_700_000_900_001);

    let result!: Awaited<ReturnType<ReturnType<typeof useAuth>["logoutAll"]>>;
    await act(async () => {
      result = await getAuth().logoutAll();
    });

    expect(refreshSessionRequestMock).toHaveBeenNthCalledWith(
      2,
      "refresh-token-2",
      { deviceId: "device-id" },
    );
    expect(revokeAllSessionsMock).toHaveBeenCalledTimes(1);
    expect(revokeAllSessionsMock).toHaveBeenCalledWith({
      accessToken: "access-token-3",
      deviceId: "device-id",
    });
    expect(saveAuthSessionMock).not.toHaveBeenCalled();
    expect(result.remoteRevoked).toBe(true);
    expect(getAuth().status).toBe("anonymous");
  });
});
