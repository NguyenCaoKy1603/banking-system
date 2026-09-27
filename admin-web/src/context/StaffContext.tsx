import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { adminFetch, idempotencyKey, type ApiError } from "../api";
import {
  getActiveSessionScope,
  invalidateSessionScope,
  startNewSessionScope,
  type SessionScope,
} from "../features/customers/actionIntent.ts";
import type { Staff } from "../types";
import { drainPendingLogout, type PendingLogout } from "./logoutCoordinator";

interface StaffContextValue {
  staff: Staff | null;
  permissions: string[];
  sessionScope: SessionScope | null;
  loading: boolean;
  error: ApiError | null;
  canReadApprovals: boolean;
  stepUpFreshUntil: number;
  setStepUpFreshUntil: (timestamp: number) => void;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  hasRole: (...roles: string[]) => boolean;
  roleList: string;
  setStaffSession: (staff: Staff, permissions?: string[]) => void;
  logout: () => Promise<void>;
  ensureLoggedOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const StaffContext = createContext<StaffContextValue | null>(null);

export function StaffProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [sessionScope, setSessionScope] = useState<SessionScope | null>(() => getActiveSessionScope());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [stepUpFreshUntil, setStepUpFreshUntil] = useState(0);
  const authEpochRef = useRef(0);
  const pendingLogoutRef = useRef<PendingLogout | null>(null);

  const ensureLoggedOut = useCallback(async () => {
    if (pendingLogoutRef.current) {
      await drainPendingLogout(pendingLogoutRef.current);
      pendingLogoutRef.current = null;
    }
  }, []);

  const setStaffSession = useCallback((newStaff: Staff, perms?: string[]) => {
    if (pendingLogoutRef.current) {
      try {
        pendingLogoutRef.current.abortController.abort();
      } catch {}
      pendingLogoutRef.current = null;
    }
    authEpochRef.current += 1;
    const newScope = startNewSessionScope(newStaff.id);
    setSessionScope(newScope);
    setStaff(newStaff);
    const resolved = perms ?? newStaff.permissions ?? [];
    setPermissions(resolved);
  }, []);

  const refreshSession = useCallback(async () => {
    const currentEpoch = ++authEpochRef.current;
    setLoading(true);
    setError(null);
    try {
      await adminFetch<{ csrfToken: string }>("/admin/auth/refresh", {
        method: "POST",
        body: "{}",
      });
      if (authEpochRef.current !== currentEpoch) return;

      const result = await adminFetch<{ staff: Staff; permissions?: string[] }>("/admin/me");
      if (authEpochRef.current !== currentEpoch) return;

      const perms = result.permissions ?? result.staff.permissions ?? [];
      const active = getActiveSessionScope();
      if (!active || active.staffId !== result.staff.id) {
        const newScope = startNewSessionScope(result.staff.id);
        setSessionScope(newScope);
      } else {
        setSessionScope(active);
      }
      setStaff({ ...result.staff, permissions: perms });
      setPermissions(perms);
    } catch (caught) {
      if (authEpochRef.current !== currentEpoch) return;
      const apiError = caught as ApiError;
      if (apiError.status !== 401) {
        setError(apiError);
      }
      invalidateSessionScope();
      setSessionScope(null);
      setStaff(null);
      setPermissions([]);
      setStepUpFreshUntil(0);
    } finally {
      if (authEpochRef.current === currentEpoch) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    const logoutEpoch = ++authEpochRef.current;
    // 1. Immediately invalidate scope and clear UI state so user sees login form
    invalidateSessionScope();
    setSessionScope(null);
    setStaff(null);
    setPermissions([]);
    setStepUpFreshUntil(0);

    // 2. Abort any previous logout in flight
    if (pendingLogoutRef.current) {
      try {
        pendingLogoutRef.current.abortController.abort();
      } catch {}
      pendingLogoutRef.current = null;
    }

    const abortController = new AbortController();
    const logoutPromise = (async () => {
      try {
        await adminFetch("/admin/auth/logout", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey("admin-logout") },
          body: "{}",
          signal: abortController.signal,
          timeoutMs: 4000,
        });
      } catch {
        // Network errors or client aborts during logout are safely handled
      } finally {
        if (pendingLogoutRef.current?.abortController === abortController) {
          pendingLogoutRef.current = null;
        }
        if (authEpochRef.current === logoutEpoch) {
          invalidateSessionScope();
          setSessionScope(null);
          setStaff(null);
          setPermissions([]);
          setStepUpFreshUntil(0);
        }
      }
    })();

    pendingLogoutRef.current = { promise: logoutPromise, abortController };
    await logoutPromise;
  }, []);

  const hasRole = useCallback(
    (...roles: string[]) => {
      if (!staff?.roles) return false;
      return staff.roles.some(
        (assignment) =>
          roles.includes(assignment.role) &&
          (!assignment.expiresAt || Date.parse(assignment.expiresAt) > Date.now())
      );
    },
    [staff]
  );

  const hasPermission = useCallback(
    (permission: string) => {
      if (!staff) return false;
      return permissions.includes(permission);
    },
    [staff, permissions]
  );

  const hasAnyPermission = useCallback(
    (...perms: string[]) => {
      if (!staff) return false;
      return perms.some((p) => permissions.includes(p));
    },
    [staff, permissions]
  );

  const canReadApprovals = useMemo(() => {
    if (!staff) return false;
    return permissions.includes("audit.read");
  }, [staff, permissions]);

  const roleList = useMemo(() => {
    if (!staff?.roles) return "";
    return staff.roles.map((r) => r.role).join(" · ");
  }, [staff]);

  const value = useMemo(
    () => ({
      staff,
      permissions,
      sessionScope,
      loading,
      error,
      canReadApprovals,
      stepUpFreshUntil,
      setStepUpFreshUntil,
      hasPermission,
      hasAnyPermission,
      hasRole,
      roleList,
      setStaffSession,
      logout,
      ensureLoggedOut,
      refreshSession,
    }),
    [
      staff,
      permissions,
      sessionScope,
      loading,
      error,
      canReadApprovals,
      stepUpFreshUntil,
      setStepUpFreshUntil,
      hasPermission,
      hasAnyPermission,
      hasRole,
      roleList,
      setStaffSession,
      logout,
      ensureLoggedOut,
      refreshSession,
    ]
  );

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function useStaff(): StaffContextValue {
  const ctx = useContext(StaffContext);
  if (!ctx) {
    throw new Error("useStaff must be used within StaffProvider");
  }
  return ctx;
}
