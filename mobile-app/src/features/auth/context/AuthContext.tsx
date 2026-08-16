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
  RegisterResult,
  VerifyAuthChallengeRequest,
} from "@/features/auth/types/auth";
import { isAuthChallengeResponse } from "@/features/auth/services/authResponseValidators";
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
import { clearTransferIntent } from "@/features/transfers/storage/transferIntentStorage";
import { clearSavingsIntent } from "@/features/savings/storage/savingsIntentStorage";
import { clearCardPaymentIntent } from "@/features/credit/storage/cardPaymentIntentStorage";

export type AuthStatus =
  | "booting"
  | "anonymous"
  | "authenticated"
  | "refreshing";

type RefreshAccessToken = () => Promise<string | null>;

type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  pendingLoginChallenge: AuthChallengeResponse | null;
  deviceId: string | null;
  isAuthenticated: boolean;
  refreshAccessToken: RefreshAccessToken;
  login: (request: LoginRequest) => Promise<void>;
  register: (request: RegisterRequest) => Promise<RegisterResult>;
  verifyLoginChallenge: (request: VerifyAuthChallengeRequest) => Promise<void>;
  verifyRegistrationChallenge: (request: VerifyAuthChallengeRequest) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [pendingLoginChallenge, setPendingLoginChallenge] =
    useState<AuthChallengeResponse | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const refreshPromiseRef = useRef<Promise<AuthSession | null> | null>(null);
  const isMountedRef = useRef(true);

  const setActiveSession = useCallback(
    (nextSession: AuthSession | null, nextStatus: AuthStatus) => {
      sessionRef.current = nextSession;

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
      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current;
      }

      const operation = (async () => {
        if (isMountedRef.current) {
          setStatus("refreshing");
        }

        try {
          const currentDeviceId = await ensureDeviceId();
          const response = await refreshSessionRequest(currentSession.refreshToken, {
            deviceId: currentDeviceId,
          });
          const nextSession = createAuthSession(response);

          await saveAuthSession(nextSession);
          setActiveSession(nextSession, "authenticated");
          return nextSession;
        } catch {
          await clearAuthSession().catch(() => undefined);
          await clearTransferIntent().catch(() => undefined);
          await clearSavingsIntent().catch(() => undefined);
          await clearCardPaymentIntent().catch(() => undefined);
          setActiveSession(null, "anonymous");
          return null;
        } finally {
          refreshPromiseRef.current = null;
        }
      })();

      refreshPromiseRef.current = operation;
      return operation;
    },
    [ensureDeviceId, setActiveSession],
  );

  const refreshAccessToken = useCallback<RefreshAccessToken>(async () => {
    const currentSession = sessionRef.current;

    if (!currentSession) {
      return null;
    }

    const refreshedSession = await refreshSession(currentSession);
    return refreshedSession?.accessToken ?? null;
  }, [refreshSession]);

  useEffect(() => {
    isMountedRef.current = true;

    void ensureDeviceId()
      .then(() => loadAuthSession())
      .then((storedSession) => {
        if (!isMountedRef.current) {
          return;
        }

        if (!storedSession) {
          setActiveSession(null, "anonymous");
          return;
        }

        if (isAccessTokenExpired(storedSession)) {
          // Keep the protected navigator mounted while rotating the token.
          setActiveSession(storedSession, "refreshing");
          void refreshSession(storedSession);
          return;
        }

        setActiveSession(storedSession, "authenticated");
      })
      .catch(() => {
        if (!isMountedRef.current) {
          return;
        }

        // A storage read failure must not leave navigation stuck on booting.
        setActiveSession(null, "anonymous");
      });

    return () => {
      isMountedRef.current = false;
    };
  }, [ensureDeviceId, refreshSession, setActiveSession]);

  const login = useCallback(
    async (request: LoginRequest) => {
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

  const logout = useCallback(async () => {
    const pendingRefresh = refreshPromiseRef.current;

    if (pendingRefresh) {
      await pendingRefresh;
    }

    const currentSession = sessionRef.current;

    try {
      if (currentSession?.refreshToken) {
        const currentDeviceId = await ensureDeviceId();
        await revokeSession(currentSession.refreshToken, {
          deviceId: currentDeviceId,
        });
      }
    } catch {
      // Local logout must still complete when the revoke endpoint is offline.
    } finally {
      await clearAuthSession().catch(() => undefined);
      await clearTransferIntent().catch(() => undefined);
      await clearSavingsIntent().catch(() => undefined);
      await clearCardPaymentIntent().catch(() => undefined);
      setPendingLoginChallenge(null);
      setActiveSession(null, "anonymous");
    }
  }, [ensureDeviceId, setActiveSession]);

  const logoutAll = useCallback(async () => {
    const pendingRefresh = refreshPromiseRef.current;

    if (pendingRefresh) {
      await pendingRefresh;
    }

    const currentSession = sessionRef.current;

    try {
      if (currentSession?.accessToken) {
        const currentDeviceId = await ensureDeviceId();
        await revokeAllSessions({
          accessToken: currentSession.accessToken,
          deviceId: currentDeviceId,
          refreshAccessToken,
        });
      }
    } catch {
      // Local logout must still complete when the revoke endpoint is offline.
    } finally {
      await clearAuthSession().catch(() => undefined);
      await clearTransferIntent().catch(() => undefined);
      await clearSavingsIntent().catch(() => undefined);
      await clearCardPaymentIntent().catch(() => undefined);
      setPendingLoginChallenge(null);
      setActiveSession(null, "anonymous");
    }
  }, [ensureDeviceId, refreshAccessToken, setActiveSession]);

  const value = useMemo(
    () => ({
      status,
      session,
      pendingLoginChallenge,
      deviceId,
      isAuthenticated:
        (status === "authenticated" || status === "refreshing") &&
        session !== null,
      refreshAccessToken,
      login,
      register,
      verifyLoginChallenge,
      verifyRegistrationChallenge,
      logout,
      logoutAll,
    }),
    [
      deviceId,
      login,
      logout,
      logoutAll,
      pendingLoginChallenge,
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
