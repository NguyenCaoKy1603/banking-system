import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import {
  login as loginRequest,
  refreshSession as refreshSessionRequest,
  register as registerRequest,
  revokeAllSessions,
  revokeSession,
  verifyLoginChallenge as verifyLoginChallengeRequest,
  verifyRegistrationChallenge as verifyRegistrationChallengeRequest,
} from "@/features/auth/services/authApi";
import type {
  AuthChallengeResponse,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  VerifyAuthChallengeRequest,
} from "@/features/auth/types/auth";
import { isAuthChallengeResponse } from "@/features/auth/services/authResponseValidators";
import { isTerminalRefreshFailure } from "@/features/auth/domain/refreshFailure";
import {
  createAuthSession,
  isAccessTokenExpired,
  type AuthSession,
} from "@/features/auth/types/session";
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from "@/features/auth/storage/authSessionStorage";
import { loadDeviceBindingId } from "@/features/auth/storage/deviceBindingStorage";
import { ApiError } from "@/services/api/ApiError";

export type AuthStatus =
  | "booting"
  | "anonymous"
  | "authenticated"
  | "locked"
  | "loggingOut"
  | "refreshing";

type RefreshAccessToken = () => Promise<string | null>;

export type LogoutResult = {
  localSessionCleared: boolean;
  remoteRevoked: boolean;
  recoveryIntentsPreserved: true;
};

type LogoutScope = "current" | "all";

function buildLogoutNotice(
  scope: LogoutScope,
  result: LogoutResult,
): string | null {
  const issues: string[] = [];

  if (!result.localSessionCleared) {
    issues.push("chưa xóa được thông tin đăng nhập lưu trên thiết bị");
  }
  if (!result.remoteRevoked) {
    issues.push(
      scope === "all"
        ? "chưa thể xác nhận đăng xuất các thiết bị khác"
        : "máy chủ chưa xác nhận thu hồi phiên từ xa",
    );
  }
  return issues.length > 0
    ? `Ứng dụng đã chuyển về màn hình đăng nhập, nhưng ${issues.join("; ")}.`
    : null;
}

async function revokeAllSessionsForLogout(
  session: AuthSession,
  deviceId: string,
): Promise<void> {
  let accessToken = session.accessToken;
  let explicitRefreshAttempted = false;
  const canRefresh = session.refreshToken.trim().length > 0;
  const refreshForLogout = async () => {
    explicitRefreshAttempted = true;
    const response = await refreshSessionRequest(session.refreshToken, {
      deviceId,
    });
    accessToken = response.accessToken;
  };

  if (isAccessTokenExpired(session) && canRefresh) {
    await refreshForLogout();
  }

  try {
    await revokeAllSessions({ accessToken, deviceId });
  } catch (error: unknown) {
    if (
      explicitRefreshAttempted ||
      !canRefresh ||
      !(error instanceof ApiError) ||
      error.status !== 401
    ) {
      throw error;
    }

    await refreshForLogout();
    await revokeAllSessions({ accessToken, deviceId });
  }
}

type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  pendingLoginChallenge: AuthChallengeResponse | null;
  logoutNotice: string | null;
  deviceId: string | null;
  isAuthenticated: boolean;
  refreshAccessToken: RefreshAccessToken;
  login: (request: LoginRequest) => Promise<void>;
  register: (request: RegisterRequest) => Promise<AuthChallengeResponse>;
  verifyLoginChallenge: (request: VerifyAuthChallengeRequest) => Promise<void>;
  verifyRegistrationChallenge: (request: VerifyAuthChallengeRequest) => Promise<RegisterResponse>;
  cancelLoginChallenge: () => void;
  logout: () => Promise<LogoutResult>;
  logoutAll: () => Promise<LogoutResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [pendingLoginChallenge, setPendingLoginChallenge] =
    useState<AuthChallengeResponse | null>(null);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  const statusRef = useRef<AuthStatus>("booting");
  const appStateRef = useRef<AppStateStatus>(AppState.currentState ?? "active");
  const deviceIdRef = useRef<string | null>(null);
  const refreshPromisesRef = useRef(
    new Map<string, Promise<AuthSession | null>>(),
  );
  const invalidatedSessionEpochsRef = useRef(new Set<string>());
  const sessionLifecycleEpochRef = useRef(0);
  const logoutOperationRef = useRef<Promise<LogoutResult> | null>(null);
  const isMountedRef = useRef(true);

  const setActiveSession = useCallback(
    (nextSession: AuthSession | null, nextStatus: AuthStatus) => {
      sessionRef.current = nextSession;
      statusRef.current = nextStatus;

      if (isMountedRef.current) {
        setSession(nextSession);
        setStatus(nextStatus);
      }
    },
    [],
  );

  const ensureDeviceId = useCallback(async () => {
    if (deviceIdRef.current) {
      return deviceIdRef.current;
    }

    const nextDeviceId = await loadDeviceBindingId();
    deviceIdRef.current = nextDeviceId;

    if (isMountedRef.current) {
      setDeviceId(nextDeviceId);
    }

    return nextDeviceId;
  }, []);

  const refreshSession = useCallback(
    (currentSession: AuthSession): Promise<AuthSession | null> => {
      const sessionEpoch = currentSession.sessionEpoch;

      if (
        statusRef.current === "loggingOut" ||
        invalidatedSessionEpochsRef.current.has(sessionEpoch) ||
        sessionRef.current?.sessionEpoch !== sessionEpoch
      ) {
        return Promise.resolve(null);
      }

      const existingPromise = refreshPromisesRef.current.get(sessionEpoch);
      if (existingPromise) {
        return existingPromise;
      }

      let operation!: Promise<AuthSession | null>;
      operation = (async () => {
        let refreshedSession: AuthSession | null = null;
        const transientFallbackStatus =
          statusRef.current === "locked" ? "locked" : "authenticated";
        if (
          isMountedRef.current &&
          sessionRef.current?.sessionEpoch === sessionEpoch
        ) {
          statusRef.current = "refreshing";
          setStatus("refreshing");
        }

        try {
          const currentDeviceId = await ensureDeviceId();
          if (
            invalidatedSessionEpochsRef.current.has(sessionEpoch) ||
            sessionRef.current?.sessionEpoch !== sessionEpoch
          ) {
            return null;
          }
          const response = await refreshSessionRequest(currentSession.refreshToken, {
            deviceId: currentDeviceId,
          });
          refreshedSession = createAuthSession(
            response,
            Date.now(),
            sessionEpoch,
          );

          if (invalidatedSessionEpochsRef.current.has(sessionEpoch)) {
            return refreshedSession;
          }
          if (sessionRef.current?.sessionEpoch !== sessionEpoch) {
            return null;
          }

          await saveAuthSession(refreshedSession);
          if (invalidatedSessionEpochsRef.current.has(sessionEpoch)) {
            return refreshedSession;
          }
          if (sessionRef.current?.sessionEpoch !== sessionEpoch) {
            return null;
          }
          setActiveSession(
            refreshedSession,
            appStateRef.current === "active" ? "authenticated" : "locked",
          );
          return refreshedSession;
        } catch (error: unknown) {
          if (invalidatedSessionEpochsRef.current.has(sessionEpoch)) {
            return refreshedSession;
          }
          if (sessionRef.current?.sessionEpoch !== sessionEpoch) {
            return null;
          }

          if (isTerminalRefreshFailure(error)) {
            await clearAuthSession().catch(() => undefined);
            setActiveSession(null, "anonymous");
            return null;
          }

          setActiveSession(
            currentSession,
            appStateRef.current === "active"
              ? transientFallbackStatus
              : "locked",
          );
          throw error;
        } finally {
          if (refreshPromisesRef.current.get(sessionEpoch) === operation) {
            refreshPromisesRef.current.delete(sessionEpoch);
          }
        }
      })();

      refreshPromisesRef.current.set(sessionEpoch, operation);
      return operation;
    },
    [ensureDeviceId, setActiveSession],
  );

  const refreshAccessTokenForEpoch = useCallback(async (
    expectedSessionEpoch: string,
  ) => {
    const currentSession = sessionRef.current;

    if (
      statusRef.current === "loggingOut" ||
      invalidatedSessionEpochsRef.current.has(expectedSessionEpoch) ||
      !currentSession ||
      currentSession.sessionEpoch !== expectedSessionEpoch
    ) {
      return null;
    }

    const refreshedSession = await refreshSession(currentSession);
    return !invalidatedSessionEpochsRef.current.has(expectedSessionEpoch) &&
      sessionRef.current?.sessionEpoch === expectedSessionEpoch &&
      refreshedSession?.sessionEpoch === expectedSessionEpoch
      ? refreshedSession.accessToken
      : null;
  }, [refreshSession]);

  const activeSessionEpoch = session?.sessionEpoch ?? null;
  const refreshAccessToken = useCallback<RefreshAccessToken>(async () => {
    return activeSessionEpoch
      ? refreshAccessTokenForEpoch(activeSessionEpoch)
      : null;
  }, [activeSessionEpoch, refreshAccessTokenForEpoch]);

  useEffect(() => {
    isMountedRef.current = true;
    const bootLifecycleEpoch = sessionLifecycleEpochRef.current;

    void ensureDeviceId()
      .then(() => loadAuthSession())
      .then((storedSession) => {
        if (
          !isMountedRef.current ||
          sessionLifecycleEpochRef.current !== bootLifecycleEpoch
        ) {
          return;
        }

        if (!storedSession) {
          setActiveSession(null, "anonymous");
          return;
        }

        // A restored session remains locked until the server validates and
        // rotates it. This avoids rendering cached financial data for a
        // remotely revoked or stale session during cold start.
        setActiveSession(storedSession, "locked");
        void refreshSession(storedSession).catch(() => undefined);
      })
      .catch(() => {
        if (
          !isMountedRef.current ||
          sessionLifecycleEpochRef.current !== bootLifecycleEpoch
        ) {
          return;
        }

        // A storage read failure must not leave navigation stuck on booting.
        setActiveSession(null, "anonymous");
      });

    return () => {
      isMountedRef.current = false;
    };
  }, [ensureDeviceId, refreshSession, setActiveSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      const currentSession = sessionRef.current;
      if (!currentSession) return;

      if (nextState !== "active") {
        setActiveSession(currentSession, "locked");
        return;
      }
      if (statusRef.current === "locked") {
        void refreshSession(currentSession).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [refreshSession, setActiveSession]);

  const login = useCallback(
    async (request: LoginRequest) => {
      setLogoutNotice(null);
      const currentDeviceId = await ensureDeviceId();
      const response = await loginRequest(request, { deviceId: currentDeviceId });

      if (isAuthChallengeResponse(response)) {
        setPendingLoginChallenge(response);
        return;
      }

      setPendingLoginChallenge(null);
      const nextSession = createAuthSession(response);

      await saveAuthSession(nextSession);
      setActiveSession(nextSession, "authenticated");
    },
    [ensureDeviceId, setActiveSession],
  );

  const verifyLoginChallenge = useCallback(
    async (request: VerifyAuthChallengeRequest) => {
      const currentDeviceId = await ensureDeviceId();
      const response = await verifyLoginChallengeRequest(request, {
        deviceId: currentDeviceId,
      });
      const nextSession = createAuthSession(response);

      await saveAuthSession(nextSession);
      setLogoutNotice(null);
      setPendingLoginChallenge(null);
      setActiveSession(nextSession, "authenticated");
    },
    [ensureDeviceId, setActiveSession],
  );

  const register = useCallback(
    async (request: RegisterRequest) => {
      const currentDeviceId = await ensureDeviceId();
      return registerRequest(request, { deviceId: currentDeviceId });
    },
    [ensureDeviceId],
  );

  const verifyRegistrationChallenge = useCallback(
    async (request: VerifyAuthChallengeRequest) => {
      const currentDeviceId = await ensureDeviceId();
      return verifyRegistrationChallengeRequest(request, {
        deviceId: currentDeviceId,
      });
    },
    [ensureDeviceId],
  );

  const cancelLoginChallenge = useCallback(() => {
    setPendingLoginChallenge(null);
  }, []);

  const waitForPendingRefreshes = useCallback(async (
    sessionEpoch: string | null,
  ): Promise<AuthSession | null> => {
    const pendingRefreshes = [...refreshPromisesRef.current.entries()];
    const results = await Promise.allSettled(
      pendingRefreshes.map(([, operation]) => operation),
    );

    if (!sessionEpoch) {
      return null;
    }

    const matchingIndex = pendingRefreshes.findIndex(
      ([epoch]) => epoch === sessionEpoch,
    );
    const matchingResult = results[matchingIndex];
    return matchingResult?.status === "fulfilled"
      ? matchingResult.value
      : null;
  }, []);

  const clearLocalSession = useCallback(async () => {
    let localSessionCleared = true;
    try {
      await clearAuthSession();
    } catch {
      localSessionCleared = false;
    }
    setPendingLoginChallenge(null);
    setActiveSession(null, "anonymous");
    return localSessionCleared;
  }, [setActiveSession]);

  const beginLogout = useCallback((scope: LogoutScope): Promise<LogoutResult> => {
    if (logoutOperationRef.current) {
      return logoutOperationRef.current;
    }

    const currentSession = sessionRef.current;
    const sessionEpoch = currentSession?.sessionEpoch ?? null;
    if (sessionEpoch) {
      invalidatedSessionEpochsRef.current.add(sessionEpoch);
    }
    sessionLifecycleEpochRef.current += 1;
    setActiveSession(null, "loggingOut");

    const operation = (async () => {
      const refreshedSession = await waitForPendingRefreshes(sessionEpoch);
      const sessionForRevocation =
        refreshedSession?.sessionEpoch === sessionEpoch
          ? refreshedSession
          : currentSession;
      let remoteRevoked =
        scope === "all"
          ? !sessionForRevocation?.accessToken
          : !sessionForRevocation?.refreshToken;

      try {
        if (scope === "all" && sessionForRevocation?.accessToken) {
          const currentDeviceId = await ensureDeviceId();
          await revokeAllSessionsForLogout(
            sessionForRevocation,
            currentDeviceId,
          );
          remoteRevoked = true;
        } else if (scope === "current" && sessionForRevocation?.refreshToken) {
          const currentDeviceId = await ensureDeviceId();
          await revokeSession(sessionForRevocation.refreshToken, {
            deviceId: currentDeviceId,
          });
          remoteRevoked = true;
        }
      } catch {
        remoteRevoked = false;
      }

      const localSessionCleared = await clearLocalSession();
      if (sessionEpoch) {
        invalidatedSessionEpochsRef.current.delete(sessionEpoch);
      }
      const result: LogoutResult = {
        localSessionCleared,
        remoteRevoked,
        recoveryIntentsPreserved: true,
      };
      if (isMountedRef.current) {
        setLogoutNotice(buildLogoutNotice(scope, result));
      }
      return result;
    })();

    logoutOperationRef.current = operation;
    void operation.then(
      () => {
        if (logoutOperationRef.current === operation) {
          logoutOperationRef.current = null;
        }
      },
      () => {
        if (logoutOperationRef.current === operation) {
          logoutOperationRef.current = null;
        }
      },
    );
    return operation;
  }, [clearLocalSession, ensureDeviceId, setActiveSession, waitForPendingRefreshes]);

  const logout = useCallback(
    (): Promise<LogoutResult> => beginLogout("current"),
    [beginLogout],
  );

  const logoutAll = useCallback(
    (): Promise<LogoutResult> => beginLogout("all"),
    [beginLogout],
  );

  const value = useMemo(
    () => ({
      status,
      session,
      pendingLoginChallenge,
      logoutNotice,
      deviceId,
      isAuthenticated:
        status === "authenticated" && session !== null,
      refreshAccessToken,
      login,
      register,
      verifyLoginChallenge,
      verifyRegistrationChallenge,
      cancelLoginChallenge,
      logout,
      logoutAll,
    }),
    [
      cancelLoginChallenge,
      deviceId,
      login,
      logout,
      logoutAll,
      pendingLoginChallenge,
      logoutNotice,
      refreshAccessToken,
      register,
      session,
      status,
      verifyLoginChallenge,
      verifyRegistrationChallenge,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth phải được sử dụng bên trong AuthProvider");
  }

  return context;
}
