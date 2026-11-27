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
  beginBiometricLoginChallenge as beginBiometricLoginChallengeRequest,
  login as loginRequest,
  refreshSession as refreshSessionRequest,
  register as registerRequest,
  resendRegistrationChallenge as resendRegistrationChallengeRequest,
  cancelRegistration as cancelRegistrationRequest,
  revokeAllSessions,
  revokeSession,
  verifyBiometricLogin as verifyBiometricLoginRequest,
  verifyRegistrationChallenge as verifyRegistrationChallengeRequest,
} from "@/features/auth/services/authApi";
import {
  clearBiometricCredential,
  clearLastBiometricHint,
  loadBiometricCredential,
  loadLastBiometricHint,
  saveLastBiometricHint,
} from "@/features/auth/storage/biometricCredentialStorage";
import {
  createDeviceBoundBiometricAssertion,
  requestBiometricAuthentication,
} from "@/services/security/biometricAuth";
import type {
  AuthChallengeResponse,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  VerifyAuthChallengeRequest,
} from "@/features/auth/types/auth";
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
import { clearPendingTotpEnrollment } from "@/features/auth/storage/mfaEnrollmentMemoryCache";
import { ApiError } from "@/services/api/ApiError";

/**
 * Allows brief app switching (for example copying a 6-digit TOTP code from an
 * authenticator app on the same device) before background lock tears down UI state.
 */
export const BACKGROUND_LOCK_GRACE_MS = 30_000;

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

export type CompleteMfaRevocationInput = {
  recoveryCodes?: string[];
  notice?: string;
};

type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  logoutNotice: string | null;
  deviceId: string | null;
  isAuthenticated: boolean;
  pendingRecoveryCodes: string[] | null;
  refreshAccessToken: RefreshAccessToken;
  login: (request: LoginRequest) => Promise<void>;
  loginWithBiometric?: () => Promise<void>;
  register: (request: RegisterRequest) => Promise<AuthChallengeResponse>;
  verifyRegistrationChallenge: (request: VerifyAuthChallengeRequest) => Promise<RegisterResponse>;
  resendRegistrationChallenge: (challengeId: string) => Promise<AuthChallengeResponse>;
  cancelRegistration?: (challengeId: string) => Promise<void>;
  completeMfaRevocation: (input?: CompleteMfaRevocationInput) => Promise<void>;
  clearPendingRecoveryCodes: () => void;
  logout: () => Promise<LogoutResult>;
  logoutAll: () => Promise<LogoutResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[] | null>(null);
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
  const pendingStorageClearRef = useRef<Promise<void> | null>(null);
  const backgroundedAtRef = useRef<number | null>(null);
  const backgroundLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isMountedRef = useRef(true);

  const clearBackgroundLockState = useCallback(() => {
    if (backgroundLockTimerRef.current !== null) {
      clearTimeout(backgroundLockTimerRef.current);
      backgroundLockTimerRef.current = null;
    }
    backgroundedAtRef.current = null;
  }, []);

  const isWithinBackgroundGrace = useCallback(() => {
    const backgroundedAt = backgroundedAtRef.current;
    return (
      backgroundedAt !== null &&
      Date.now() - backgroundedAt < BACKGROUND_LOCK_GRACE_MS
    );
  }, []);

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
        const startedAuthenticated = statusRef.current === "authenticated";
        const transientFallbackStatus = startedAuthenticated
          ? "authenticated"
          : "locked";
        // Avoid dropping the mounted navigator for silent token rotations while
        // the user is already authenticated; only locked/booting restores show
        // the refreshing lock gate.
        if (
          !startedAuthenticated &&
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
          const keepUnlocked =
            appStateRef.current === "active" ||
            (startedAuthenticated &&
              statusRef.current === "authenticated" &&
              isWithinBackgroundGrace());
          setActiveSession(
            refreshedSession,
            keepUnlocked ? "authenticated" : "locked",
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
            clearBackgroundLockState();
            clearPendingTotpEnrollment();
            await clearAuthSession().catch(() => undefined);
            setActiveSession(null, "anonymous");
            return null;
          }

          const keepFallbackStatus =
            appStateRef.current === "active" ||
            (transientFallbackStatus === "authenticated" &&
              statusRef.current === "authenticated" &&
              isWithinBackgroundGrace());
          setActiveSession(
            currentSession,
            keepFallbackStatus ? transientFallbackStatus : "locked",
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
    [
      clearBackgroundLockState,
      ensureDeviceId,
      isWithinBackgroundGrace,
      setActiveSession,
    ],
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
      clearBackgroundLockState();
    };
  }, [clearBackgroundLockState, ensureDeviceId, refreshSession, setActiveSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      const currentSession = sessionRef.current;
      if (!currentSession) {
        clearBackgroundLockState();
        return;
      }

      if (nextState !== "active") {
        if (statusRef.current !== "authenticated") {
          return;
        }
        if (backgroundedAtRef.current === null) {
          backgroundedAtRef.current = Date.now();
        }
        if (backgroundLockTimerRef.current === null) {
          backgroundLockTimerRef.current = setTimeout(() => {
            backgroundLockTimerRef.current = null;
            if (
              appStateRef.current !== "active" &&
              sessionRef.current &&
              statusRef.current === "authenticated"
            ) {
              setActiveSession(sessionRef.current, "locked");
            }
          }, BACKGROUND_LOCK_GRACE_MS);
        }
        return;
      }

      const backgroundedAt = backgroundedAtRef.current;
      const elapsedMs =
        backgroundedAt !== null ? Date.now() - backgroundedAt : 0;
      clearBackgroundLockState();

      if (statusRef.current === "locked") {
        void refreshSession(currentSession).catch(() => undefined);
        return;
      }

      if (
        statusRef.current === "authenticated" &&
        backgroundedAt !== null &&
        elapsedMs >= BACKGROUND_LOCK_GRACE_MS
      ) {
        // Mobile OSes often suspend timers in background; enforce grace timeout on resume.
        setActiveSession(currentSession, "locked");
        void refreshSession(currentSession).catch(() => undefined);
      }
    });
    return () => {
      subscription?.remove();
      clearBackgroundLockState();
    };
  }, [clearBackgroundLockState, refreshSession, setActiveSession]);

  const login = useCallback(
    async (request: LoginRequest) => {
      clearBackgroundLockState();
      clearPendingTotpEnrollment();
      sessionLifecycleEpochRef.current += 1;
      setLogoutNotice(null);
      setPendingRecoveryCodes(null);

      if (pendingStorageClearRef.current) {
        await pendingStorageClearRef.current.catch(() => undefined);
      }

      const currentDeviceId = await ensureDeviceId();
      const response = await loginRequest(request, { deviceId: currentDeviceId });
      const nextSession = createAuthSession(response);

      await saveAuthSession(nextSession);
      const existingBiometric = await loadBiometricCredential(
        nextSession.user.id,
        currentDeviceId,
      ).catch(() => null);
      if (existingBiometric) {
        await saveLastBiometricHint({
          userId: nextSession.user.id,
          email: nextSession.user.email,
          fullName: nextSession.user.fullName,
          deviceId: currentDeviceId,
        }).catch(() => undefined);
      }
      setActiveSession(nextSession, "authenticated");
    },
    [clearBackgroundLockState, ensureDeviceId, setActiveSession],
  );

  const loginWithBiometric = useCallback(async () => {
    clearBackgroundLockState();
    clearPendingTotpEnrollment();
    if (isMountedRef.current) {
      setLogoutNotice(null);
      setPendingRecoveryCodes(null);
    }

    const currentDeviceId = await ensureDeviceId();
    const hint = await loadLastBiometricHint(currentDeviceId);
    if (!hint) {
      throw new Error("Thiết bị chưa liên kết tài khoản Sinh trắc học nào.");
    }
    const credential = await loadBiometricCredential(hint.userId, currentDeviceId);
    if (!credential) {
      await clearLastBiometricHint(currentDeviceId).catch(() => undefined);
      throw new Error("Không tìm thấy khóa Sinh trắc học trên thiết bị. Vui lòng đăng nhập bằng mật khẩu.");
    }

    await requestBiometricAuthentication("Xác thực để đăng nhập nhanh NOVA");
    const challenge = await beginBiometricLoginChallengeRequest(
      { email: hint.email },
      { deviceId: currentDeviceId },
    );
    const proof = createDeviceBoundBiometricAssertion({
      biometricSecret: credential.biometricSecret,
      challengeId: challenge.challengeId,
      deviceId: currentDeviceId,
      purpose: "LOGIN",
    });

    try {
      const response = await verifyBiometricLoginRequest(
        { challengeId: challenge.challengeId, proof },
        { deviceId: currentDeviceId },
      );
      const nextSession = createAuthSession(response);
      await saveAuthSession(nextSession);
      setActiveSession(nextSession, "authenticated");
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        !/locked/i.test(error.message)
      ) {
        await clearBiometricCredential(hint.userId, currentDeviceId).catch(() => undefined);
        await clearLastBiometricHint(currentDeviceId).catch(() => undefined);
      }
      throw error;
    }
  }, [clearBackgroundLockState, ensureDeviceId, setActiveSession]);

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

  const resendRegistrationChallenge = useCallback(
    async (challengeId: string) => {
      const currentDeviceId = await ensureDeviceId();
      return resendRegistrationChallengeRequest(challengeId, { deviceId: currentDeviceId });
    },
    [ensureDeviceId],
  );

  const cancelRegistration = useCallback(
    async (challengeId: string) => {
      const currentDeviceId = await ensureDeviceId();
      return cancelRegistrationRequest(challengeId, { deviceId: currentDeviceId });
    },
    [ensureDeviceId],
  );

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
    const clearOperation = (async () => {
      try {
        await clearAuthSession();
      } catch {
        localSessionCleared = false;
      }
    })();

    pendingStorageClearRef.current = clearOperation;
    try {
      await clearOperation;
    } finally {
      if (pendingStorageClearRef.current === clearOperation) {
        pendingStorageClearRef.current = null;
      }
    }
    clearBackgroundLockState();
    clearPendingTotpEnrollment();
    setActiveSession(null, "anonymous");
    return localSessionCleared;
  }, [clearBackgroundLockState, setActiveSession]);

  const beginLogout = useCallback((scope: LogoutScope): Promise<LogoutResult> => {
    if (logoutOperationRef.current) {
      return logoutOperationRef.current;
    }

    clearBackgroundLockState();
    clearPendingTotpEnrollment();
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
  }, [
    clearBackgroundLockState,
    clearLocalSession,
    ensureDeviceId,
    setActiveSession,
    waitForPendingRefreshes,
  ]);

  const logout = useCallback(
    (): Promise<LogoutResult> => beginLogout("current"),
    [beginLogout],
  );

  const logoutAll = useCallback(
    (): Promise<LogoutResult> => beginLogout("all"),
    [beginLogout],
  );

  const clearPendingRecoveryCodes = useCallback(() => {
    if (isMountedRef.current) {
      setPendingRecoveryCodes(null);
    }
  }, []);

  const completeMfaRevocation = useCallback(
    async (input?: CompleteMfaRevocationInput) => {
      clearBackgroundLockState();
      clearPendingTotpEnrollment();
      const currentSession = sessionRef.current;
      const sessionEpoch = currentSession?.sessionEpoch ?? null;
      if (sessionEpoch) {
        invalidatedSessionEpochsRef.current.add(sessionEpoch);
      }
      const completionLifecycleEpoch = (sessionLifecycleEpochRef.current += 1);

      sessionRef.current = null;
      statusRef.current = "anonymous";
      if (isMountedRef.current) {
        setSession(null);
        setStatus("anonymous");
        setPendingRecoveryCodes(input?.recoveryCodes ?? null);
      }

      let storageCleared = true;
      const clearOperation = (async () => {
        try {
          await clearAuthSession();
        } catch {
          storageCleared = false;
        }
      })();

      pendingStorageClearRef.current = clearOperation;
      try {
        await clearOperation;
      } finally {
        if (pendingStorageClearRef.current === clearOperation) {
          pendingStorageClearRef.current = null;
        }
      }

      if (sessionLifecycleEpochRef.current !== completionLifecycleEpoch) {
        return;
      }

      let notice: string | null = null;
      if (!storageCleared) {
        notice = "Phiên đã kết thúc nhưng chưa thể dọn bộ nhớ an toàn trên thiết bị. Vui lòng đăng nhập lại.";
      } else if (input?.notice) {
        notice = input.notice;
      }

      if (isMountedRef.current) {
        setLogoutNotice(notice);
      }
    },
    [clearBackgroundLockState],
  );

  const value = useMemo(
    () => ({
      status,
      session,
      logoutNotice,
      deviceId,
      isAuthenticated:
        status === "authenticated" && session !== null,
      pendingRecoveryCodes,
      refreshAccessToken,
      login,
      loginWithBiometric,
      register,
      verifyRegistrationChallenge,
      resendRegistrationChallenge,
      cancelRegistration,
      completeMfaRevocation,
      clearPendingRecoveryCodes,
      logout,
      logoutAll,
    }),
    [
      clearPendingRecoveryCodes,
      completeMfaRevocation,
      deviceId,
      login,
      loginWithBiometric,
      logout,
      logoutAll,
      logoutNotice,
      pendingRecoveryCodes,
      refreshAccessToken,
      register,
      session,
      status,
      verifyRegistrationChallenge,
      resendRegistrationChallenge,
      cancelRegistration,
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
