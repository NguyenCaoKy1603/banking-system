import { createElement, useEffect } from "react";
import {
  act,
  create,
  type ReactTestRenderer,
} from "react-test-renderer";
import { AppState, type AppStateStatus } from "react-native";

import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import {
  cancelRegistration as cancelRegistrationRequest,
  login as loginRequest,
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
import { ApiError } from "@/services/api/ApiError";

jest.mock("expo-crypto", () => ({ randomUUID: () => "mock-epoch-uuid" }));
jest.mock("@/features/auth/services/authApi", () => ({
  login: jest.fn(),
  refreshSession: jest.fn(),
  register: jest.fn(),
  resendRegistrationChallenge: jest.fn(),
  cancelRegistration: jest.fn(),
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
const cancelRegistrationRequestMock = jest.mocked(cancelRegistrationRequest);
const loginRequestMock = jest.mocked(loginRequest);
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
  jest.restoreAllMocks();
});

describe("AuthProvider registration cancellation", () => {
  it("exposes a device-bound cancel wrapper without owning registration challenge state", async () => {
    cancelRegistrationRequestMock.mockResolvedValue(undefined);
    await renderProvider();

    await act(async () => {
      await getAuth().cancelRegistration!("registration-challenge");
    });

    expect(cancelRegistrationRequestMock).toHaveBeenCalledWith(
      "registration-challenge",
      { deviceId: "device-id" },
    );
    expect(getAuth().deviceId).toBe("device-id");
    expect("registrationChallenge" in getAuth()).toBe(false);
  });

  it("propagates cancel ApiError status to the screen", async () => {
    const error = new ApiError({
      status: 404,
      code: "NOT_FOUND",
      message: "Yêu cầu không tồn tại.",
      traceId: "trace-redacted",
    });
    cancelRegistrationRequestMock.mockRejectedValue(error);
    await renderProvider();

    await expect(
      act(async () => getAuth().cancelRegistration!("registration-challenge")),
    ).rejects.toBe(error);
  });
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

describe("AuthProvider session restore and lifecycle", () => {
  it("khởi động với session lưu sẵn: giữ trạng thái refreshing/chưa authenticated và chỉ mở khóa sau khi refresh thành công", async () => {
    const refreshDeferred = createDeferred<LoginResponse>();
    refreshSessionRequestMock.mockReturnValue(refreshDeferred.promise);

    await renderProvider();

    expect(loadAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(refreshSessionRequestMock).toHaveBeenCalledTimes(1);
    expect(refreshSessionRequestMock).toHaveBeenCalledWith(
      storedSession.refreshToken,
      { deviceId: "device-id" },
    );
    expect(getAuth().status).toBe("refreshing");
    expect(getAuth().isAuthenticated).toBe(false);
    expect(getAuth().session).toEqual(storedSession);
    expect(saveAuthSessionMock).not.toHaveBeenCalled();

    await act(async () => {
      refreshDeferred.resolve(refreshedResponse);
    });

    expect(saveAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(saveAuthSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: refreshedResponse.accessToken,
        refreshToken: refreshedResponse.refreshToken,
      }),
    );
    expect(getAuth().status).toBe("authenticated");
    expect(getAuth().isAuthenticated).toBe(true);
    expect(getAuth().session?.accessToken).toBe(refreshedResponse.accessToken);
  });

  const transientErrors = [
    {
      label: "lỗi mạng (status null)",
      error: new ApiError({
        status: null,
        code: "NETWORK_ERROR",
        message: "Không thể kết nối máy chủ.",
      }),
    },
    {
      label: "hết thời gian kết nối timeout (status null)",
      error: new ApiError({
        status: null,
        code: "TIMEOUT",
        message: "Hết thời gian kết nối.",
      }),
    },
    {
      label: "giới hạn tần suất 429",
      error: new ApiError({
        status: 429,
        code: "RATE_LIMITED",
        message: "Quá nhiều yêu cầu.",
      }),
    },
    {
      label: "lỗi máy chủ 500",
      error: new ApiError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Lỗi máy chủ nội bộ.",
      }),
    },
  ];

  it.each(transientErrors)(
    "giữ nguyên phiên ở trạng thái locked khi restore gặp $label và mở khóa khi retry thành công",
    async ({ error }) => {
      refreshSessionRequestMock.mockRejectedValueOnce(error);

      await renderProvider();

      expect(clearAuthSessionMock).not.toHaveBeenCalled();
      expect(saveAuthSessionMock).not.toHaveBeenCalled();
      expect(getAuth().status).toBe("locked");
      expect(getAuth().isAuthenticated).toBe(false);
      expect(getAuth().session).toEqual(storedSession);

      refreshSessionRequestMock.mockResolvedValueOnce(refreshedResponse);

      let retryToken: string | null = null;
      await act(async () => {
        retryToken = await getAuth().refreshAccessToken();
      });

      expect(retryToken).toBe(refreshedResponse.accessToken);
      expect(saveAuthSessionMock).toHaveBeenCalledTimes(1);
      expect(saveAuthSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: refreshedResponse.accessToken,
          refreshToken: refreshedResponse.refreshToken,
        }),
      );
      expect(getAuth().status).toBe("authenticated");
      expect(getAuth().isAuthenticated).toBe(true);
      expect(clearAuthSessionMock).not.toHaveBeenCalled();
    },
  );

  it("khóa session khi chuyển sang background/inactive và tự động refresh khi quay lại active", async () => {
    const addEventListenerSpy = jest.spyOn(AppState, "addEventListener");
    refreshSessionRequestMock.mockResolvedValue(refreshedResponse);

    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getAuth().status).toBe("authenticated");
    expect(getAuth().isAuthenticated).toBe(true);

    const changeListener = addEventListenerSpy.mock.calls.find(
      ([type]) => type === "change",
    )?.[1] as ((state: AppStateStatus) => void) | undefined;

    expect(changeListener).toBeDefined();

    // 1. Chuyển sang background: session bị khóa, không còn authenticated
    act(() => {
      changeListener!("background");
    });

    expect(getAuth().status).toBe("locked");
    expect(getAuth().isAuthenticated).toBe(false);
    expect(getAuth().session).toEqual(
      expect.objectContaining({
        accessToken: refreshedResponse.accessToken,
      }),
    );

    // 2. Chuẩn bị deferred refresh promise cho lần active
    const foregroundRefreshDeferred = createDeferred<LoginResponse>();
    refreshSessionRequestMock.mockReturnValueOnce(foregroundRefreshDeferred.promise);

    // 3. Chuyển về active: kích hoạt refresh, trong lúc pending chưa authenticated
    act(() => {
      changeListener!("active");
    });

    expect(getAuth().status).toBe("refreshing");
    expect(getAuth().isAuthenticated).toBe(false);

    // 4. Hoàn tất refresh: session được lưu và chuyển sang authenticated
    const foregroundResponse: LoginResponse = {
      ...refreshedResponse,
      accessToken: "access-token-foreground",
      refreshToken: "refresh-token-foreground",
    };

    saveAuthSessionMock.mockClear();
    await act(async () => {
      foregroundRefreshDeferred.resolve(foregroundResponse);
    });

    expect(saveAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(saveAuthSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: foregroundResponse.accessToken,
        refreshToken: foregroundResponse.refreshToken,
      }),
    );
    expect(getAuth().status).toBe("authenticated");
    expect(getAuth().isAuthenticated).toBe(true);
    expect(getAuth().session?.accessToken).toBe(foregroundResponse.accessToken);
  });

  test("completeMfaRevocation invalidates session immediately, clears storage, and sets pending recovery codes", async () => {
    refreshSessionRequestMock.mockResolvedValue(refreshedResponse);

    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getAuth().isAuthenticated).toBe(true);
    clearAuthSessionMock.mockClear();

    const sampleCodes = ["code-1111-2222-3333", "code-4444-5555-6666"];
    await act(async () => {
      await getAuth().completeMfaRevocation!({ recoveryCodes: sampleCodes });
    });

    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().isAuthenticated).toBe(false);
    expect(getAuth().session).toBeNull();
    expect(getAuth().pendingRecoveryCodes).toEqual(sampleCodes);
    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);

    // clearPendingRecoveryCodes resets pending recovery codes
    act(() => {
      getAuth().clearPendingRecoveryCodes!();
    });
    expect(getAuth().pendingRecoveryCodes).toBeNull();
  });

  test("completeMfaRevocation with notice sets logoutNotice and no recovery codes", async () => {
    refreshSessionRequestMock.mockResolvedValue(refreshedResponse);

    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await getAuth().completeMfaRevocation!({
        notice: "Phương thức Authenticator đã được thu hồi. Vui lòng đăng nhập lại.",
      });
    });

    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().isAuthenticated).toBe(false);
    expect(getAuth().pendingRecoveryCodes).toBeNull();
    expect(getAuth().logoutNotice).toBe(
      "Phương thức Authenticator đã được thu hồi. Vui lòng đăng nhập lại.",
    );
  });

  test("completeMfaRevocation handles storage clearing failure gracefully without dropping codes", async () => {
    refreshSessionRequestMock.mockResolvedValue(refreshedResponse);

    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    clearAuthSessionMock.mockRejectedValueOnce(new Error("Storage disk full"));

    const sampleCodes = ["code-safe-1", "code-safe-2"];
    await act(async () => {
      await getAuth().completeMfaRevocation!({ recoveryCodes: sampleCodes });
    });

    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().isAuthenticated).toBe(false);
    expect(getAuth().pendingRecoveryCodes).toEqual(sampleCodes);
    expect(getAuth().logoutNotice).toBe(
      "Phiên đã kết thúc nhưng chưa thể dọn bộ nhớ an toàn trên thiết bị. Vui lòng đăng nhập lại.",
    );
  });

  test("deferred refresh returning late after completeMfaRevocation does not re-authenticate or overwrite codes", async () => {
    const deferredRefresh = createDeferred<LoginResponse>();
    refreshSessionRequestMock.mockReturnValue(deferredRefresh.promise);

    await renderProvider();

    // Session is booting/refreshing, then user completes MFA revocation
    const sampleCodes = ["code-persist-1", "code-persist-2"];
    await act(async () => {
      await getAuth().completeMfaRevocation!({ recoveryCodes: sampleCodes });
    });

    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().pendingRecoveryCodes).toEqual(sampleCodes);

    // Old deferred refresh resolves late
    saveAuthSessionMock.mockClear();
    await act(async () => {
      deferredRefresh.resolve(refreshedResponse);
    });

    expect(saveAuthSessionMock).not.toHaveBeenCalled();
    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().isAuthenticated).toBe(false);
    expect(getAuth().session).toBeNull();
    expect(getAuth().pendingRecoveryCodes).toEqual(sampleCodes);
  });

  test("AppState background/active when session is null does not trigger refresh or lose pending codes", async () => {
    const addEventListenerSpy = jest.spyOn(AppState, "addEventListener");
    refreshSessionRequestMock.mockResolvedValue(refreshedResponse);

    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const sampleCodes = ["code-bg-1", "code-bg-2"];
    await act(async () => {
      await getAuth().completeMfaRevocation!({ recoveryCodes: sampleCodes });
    });

    const changeListener = addEventListenerSpy.mock.calls.find(
      ([type]) => type === "change",
    )?.[1] as ((state: AppStateStatus) => void) | undefined;

    expect(changeListener).toBeDefined();

    refreshSessionRequestMock.mockClear();

    // App goes to background
    act(() => {
      changeListener!("background");
    });
    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().pendingRecoveryCodes).toEqual(sampleCodes);

    // App returns to active
    act(() => {
      changeListener!("active");
    });
    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().pendingRecoveryCodes).toEqual(sampleCodes);
    expect(refreshSessionRequestMock).not.toHaveBeenCalled();
  });

  test("pending storage clear from MFA revocation settles before new login saves session", async () => {
    let simulatedStorage: AuthSession | null = storedSession;
    clearAuthSessionMock.mockImplementation(async () => {
      simulatedStorage = null;
    });
    saveAuthSessionMock.mockImplementation(async (session) => {
      simulatedStorage = session;
    });

    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    saveAuthSessionMock.mockClear();
    clearAuthSessionMock.mockClear();

    const deferredClear = createDeferred<void>();
    clearAuthSessionMock.mockImplementationOnce(() => deferredClear.promise.then(() => {
      simulatedStorage = null;
    }));

    // Trigger revocation with notice
    let revocationDone = false;
    let revocationPromise!: Promise<void>;
    act(() => {
      revocationPromise = getAuth().completeMfaRevocation({
        notice: "Phương thức Authenticator đã được thu hồi. Vui lòng đăng nhập lại.",
      }).then(() => {
        revocationDone = true;
      });
    });

    // In-memory status is anonymous immediately
    expect(getAuth().status).toBe("anonymous");
    expect(getAuth().isAuthenticated).toBe(false);
    expect(revocationDone).toBe(false);

    // User starts new login while clear is still pending
    const newSessionResponse: LoginResponse = {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresInSeconds: 900,
      user: {
        id: "new-user-id",
        fullName: "Người Dùng Mới",
        email: "newuser@example.com",
        phoneNumber: "0987654321",
        createdAt: "2026-02-01T00:00:00Z",
      },
    };
    loginRequestMock.mockResolvedValueOnce(newSessionResponse);

    let loginDone = false;
    let loginPromise!: Promise<void>;
    act(() => {
      loginPromise = getAuth().login({
        email: "newuser@example.com",
        password: "NewPassword123!",
      }).then(() => {
        loginDone = true;
      });
    });

    // Microtasks run: login must not have saved session yet because clear is pending
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(loginDone).toBe(false);
    expect(saveAuthSessionMock).not.toHaveBeenCalled();

    // Now resolve old clear
    await act(async () => {
      deferredClear.resolve();
      await revocationPromise;
    });

    // Now finish login
    await act(async () => {
      await loginPromise;
    });

    expect(loginDone).toBe(true);
    expect(saveAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(simulatedStorage).not.toBeNull();
    expect(simulatedStorage?.accessToken).toBe("new-access-token");
    expect(getAuth().status).toBe("authenticated");
    expect(getAuth().isAuthenticated).toBe(true);
    expect(getAuth().session?.user.id).toBe("new-user-id");
    expect(getAuth().logoutNotice).toBeNull();
  });

  test("rejected storage clear from MFA revocation does not crash new login or overwrite lifecycle notice", async () => {
    let simulatedStorage: AuthSession | null = storedSession;
    clearAuthSessionMock.mockImplementation(async () => {
      simulatedStorage = null;
    });
    saveAuthSessionMock.mockImplementation(async (session) => {
      simulatedStorage = session;
    });

    await renderProvider();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    saveAuthSessionMock.mockClear();
    clearAuthSessionMock.mockClear();

    const deferredClear = createDeferred<void>();
    clearAuthSessionMock.mockImplementationOnce(() => deferredClear.promise);

    // Trigger revocation
    let revocationPromise!: Promise<void>;
    act(() => {
      revocationPromise = getAuth().completeMfaRevocation();
    });

    const newSessionResponse: LoginResponse = {
      accessToken: "new-access-token-2",
      refreshToken: "new-refresh-token-2",
      expiresInSeconds: 900,
      user: {
        id: "new-user-id-2",
        fullName: "Người Dùng Mới 2",
        email: "newuser2@example.com",
        phoneNumber: "0987654322",
        createdAt: "2026-02-01T00:00:00Z",
      },
    };
    loginRequestMock.mockResolvedValueOnce(newSessionResponse);

    let loginPromise!: Promise<void>;
    act(() => {
      loginPromise = getAuth().login({
        email: "newuser2@example.com",
        password: "NewPassword123!",
      });
    });

    // Old clear rejects with error while login proceeds
    await act(async () => {
      deferredClear.reject(new Error("SecureStore I/O timeout"));
      await revocationPromise.catch(() => undefined);
      await loginPromise;
    });

    expect(getAuth().status).toBe("authenticated");
    expect(getAuth().isAuthenticated).toBe(true);
    expect(getAuth().session?.user.id).toBe("new-user-id-2");
    expect(simulatedStorage?.accessToken).toBe("new-access-token-2");
    expect(getAuth().logoutNotice).toBeNull();
  });
});
