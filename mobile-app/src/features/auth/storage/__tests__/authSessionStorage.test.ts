import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from "@/features/auth/storage/authSessionStorage";
import type { AuthSession } from "@/features/auth/types/session";
import { isAccessTokenExpired } from "@/features/auth/types/session";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));

const AUTH_SESSION_KEY = "banking.auth.session.v2";
const LEGACY_ACCESS_TOKEN_KEY = "banking.auth.access-token.v1";
const LEGACY_REFRESH_TOKEN_KEY = "banking.auth.refresh-token.v1";
const LEGACY_METADATA_KEY = "banking.auth.metadata.v1";
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const session: AuthSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: 1_700_000_900_000,
  sessionEpoch: "session-epoch-1",
  user: {
    id: "user-id",
    fullName: "Người Dùng Thử",
    email: "tester@example.com",
    phoneNumber: "0912345678",
    createdAt: "2026-01-01T00:00:00Z",
  },
};

const deleteItemAsyncMock = jest.mocked(SecureStore.deleteItemAsync);
const getItemAsyncMock = jest.mocked(SecureStore.getItemAsync);
const setItemAsyncMock = jest.mocked(SecureStore.setItemAsync);
const randomUUIDMock = jest.mocked(Crypto.randomUUID);

function createDeferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function mockStoredValues(
  values: Partial<Record<string, string | null>> = {},
) {
  const storedValues: Record<string, string | null> = {
    [AUTH_SESSION_KEY]: JSON.stringify(session),
    [LEGACY_ACCESS_TOKEN_KEY]: null,
    [LEGACY_REFRESH_TOKEN_KEY]: null,
    [LEGACY_METADATA_KEY]: null,
    ...values,
  };

  getItemAsyncMock.mockImplementation(async (key) => storedValues[key] ?? null);
}

beforeEach(() => {
  jest.resetAllMocks();
  deleteItemAsyncMock.mockResolvedValue(undefined);
  setItemAsyncMock.mockResolvedValue(undefined);
  randomUUIDMock.mockReturnValue("00000000-0000-4000-8000-000000000002");
});

describe("authSessionStorage", () => {
  it("lưu toàn bộ session bằng một bản ghi SecureStore nguyên tử", async () => {
    await saveAuthSession(session);

    expect(setItemAsyncMock).toHaveBeenCalledTimes(1);
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      AUTH_SESSION_KEY,
      JSON.stringify(session),
      SECURE_STORE_OPTIONS,
    );
  });

  it("không ghi thêm dữ liệu bí mật ra ngoài bản ghi SecureStore", async () => {
    await saveAuthSession(session);

    const storedValue = setItemAsyncMock.mock.calls[0]?.[1];

    expect(storedValue).toBe(JSON.stringify(session));
    expect(storedValue).not.toContain("password");
    expect(storedValue).not.toContain("confirmPassword");
    expect(storedValue).not.toContain("pin");
    expect(storedValue).not.toContain("otp");
  });

  it("từ chối token rỗng trước mọi thao tác SecureStore", async () => {
    await expect(
      saveAuthSession({ ...session, accessToken: " " }),
    ).rejects.toThrow("Auth session tokens must be non-empty strings.");

    expect(deleteItemAsyncMock).not.toHaveBeenCalled();
    expect(setItemAsyncMock).not.toHaveBeenCalled();
  });

  it("từ chối metadata sai trước mọi thao tác SecureStore", async () => {
    await expect(
      saveAuthSession({
        ...session,
        accessTokenExpiresAt: Number.NaN,
      }),
    ).rejects.toThrow("Auth session metadata is invalid.");

    expect(deleteItemAsyncMock).not.toHaveBeenCalled();
    expect(setItemAsyncMock).not.toHaveBeenCalled();
  });

  it("serialize các lần ghi session để không bị ghi đè lẫn nhau", async () => {
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    let writeCount = 0;

    setItemAsyncMock.mockImplementation(() => {
      writeCount += 1;
      return writeCount === 1 ? firstWrite.promise : secondWrite.promise;
    });

    const firstSave = saveAuthSession(session);
    await Promise.resolve();
    const secondSave = saveAuthSession({
      ...session,
      accessToken: "access-token-2",
    });
    await Promise.resolve();

    expect(setItemAsyncMock).toHaveBeenCalledTimes(1);

    firstWrite.resolve(undefined);
    await firstSave;
    await Promise.resolve();

    expect(setItemAsyncMock).toHaveBeenCalledTimes(2);

    secondWrite.resolve(undefined);
    await secondSave;
  });

  it("giữ nguyên lỗi SecureStore khi ghi bản ghi nguyên tử thất bại", async () => {
    const writeError = new Error("SecureStore write failed");
    setItemAsyncMock.mockRejectedValueOnce(writeError);

    await expect(saveAuthSession(session)).rejects.toBe(writeError);
    expect(deleteItemAsyncMock).not.toHaveBeenCalled();
  });

  it("khôi phục đúng session từ bản ghi v2", async () => {
    mockStoredValues();

    await expect(loadAuthSession()).resolves.toEqual(session);
    expect(getItemAsyncMock).toHaveBeenCalledWith(
      AUTH_SESSION_KEY,
      SECURE_STORE_OPTIONS,
    );
    expect(getItemAsyncMock).toHaveBeenCalledTimes(1);
    expect(deleteItemAsyncMock).not.toHaveBeenCalled();
  });

  it("bổ sung session epoch cho bản ghi v2 cũ", async () => {
    const { sessionEpoch: _sessionEpoch, ...legacyV2Session } = session;
    mockStoredValues({
      [AUTH_SESSION_KEY]: JSON.stringify(legacyV2Session),
    });

    const loaded = await loadAuthSession();

    expect(loaded).toEqual({
      ...legacyV2Session,
      sessionEpoch: "00000000-0000-4000-8000-000000000002",
    });
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      AUTH_SESSION_KEY,
      JSON.stringify(loaded),
      SECURE_STORE_OPTIONS,
    );
  });

  it("xóa bản ghi có session epoch sai kiểu", async () => {
    mockStoredValues({
      [AUTH_SESSION_KEY]: JSON.stringify({ ...session, sessionEpoch: 42 }),
    });

    await expect(loadAuthSession()).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledTimes(4);
  });

  it("migrate session legacy sang bản ghi nguyên tử v2", async () => {
    mockStoredValues({
      [AUTH_SESSION_KEY]: null,
      [LEGACY_ACCESS_TOKEN_KEY]: session.accessToken,
      [LEGACY_REFRESH_TOKEN_KEY]: session.refreshToken,
      [LEGACY_METADATA_KEY]: JSON.stringify({
        user: session.user,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
      }),
    });

    await expect(loadAuthSession()).resolves.toEqual({
      ...session,
      sessionEpoch: "00000000-0000-4000-8000-000000000002",
    });
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      AUTH_SESSION_KEY,
      JSON.stringify({
        ...session,
        sessionEpoch: "00000000-0000-4000-8000-000000000002",
      }),
      SECURE_STORE_OPTIONS,
    );
    expect(deleteItemAsyncMock).toHaveBeenCalledTimes(3);
  });

  it("xóa session hỏng và trả null", async () => {
    mockStoredValues({ [AUTH_SESSION_KEY]: "{invalid-json" });

    await expect(loadAuthSession()).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledTimes(4);
  });

  it("xóa legacy không đầy đủ và trả null", async () => {
    mockStoredValues({
      [AUTH_SESSION_KEY]: null,
      [LEGACY_ACCESS_TOKEN_KEY]: session.accessToken,
      [LEGACY_REFRESH_TOKEN_KEY]: null,
      [LEGACY_METADATA_KEY]: JSON.stringify({
        user: session.user,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
      }),
    });

    await expect(loadAuthSession()).resolves.toBeNull();
    expect(deleteItemAsyncMock).toHaveBeenCalledTimes(3);
  });

  it("clear xóa bản ghi v2 và các key legacy", async () => {
    await clearAuthSession();

    expect(deleteItemAsyncMock).toHaveBeenCalledTimes(4);
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(
      AUTH_SESSION_KEY,
      SECURE_STORE_OPTIONS,
    );
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(
      LEGACY_ACCESS_TOKEN_KEY,
      SECURE_STORE_OPTIONS,
    );
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(
      LEGACY_REFRESH_TOKEN_KEY,
      SECURE_STORE_OPTIONS,
    );
    expect(deleteItemAsyncMock).toHaveBeenCalledWith(
      LEGACY_METADATA_KEY,
      SECURE_STORE_OPTIONS,
    );
  });

  it("vẫn load session hết hạn để session manager quyết định xử lý", async () => {
    const expiredSession: AuthSession = {
      ...session,
      accessTokenExpiresAt: 1_700_000_000_000,
    };
    mockStoredValues({ [AUTH_SESSION_KEY]: JSON.stringify(expiredSession) });

    const loadedSession = await loadAuthSession();

    expect(loadedSession).toEqual(expiredSession);
    expect(loadedSession && isAccessTokenExpired(loadedSession, 1_700_000_000_001)).toBe(
      true,
    );
  });

  it("không nuốt lỗi native khi đọc", async () => {
    const nativeError = new Error("SecureStore read failed");
    getItemAsyncMock.mockRejectedValueOnce(nativeError);

    await expect(loadAuthSession()).rejects.toBe(nativeError);
  });

  it("không nuốt lỗi native khi xóa", async () => {
    const nativeError = new Error("SecureStore delete failed");
    deleteItemAsyncMock.mockRejectedValueOnce(nativeError);

    await expect(clearAuthSession()).rejects.toBe(nativeError);
  });
});
