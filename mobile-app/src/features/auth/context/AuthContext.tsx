import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type AuthContextValue = {
  isDemoSessionActive: boolean;
  startDemoSession: () => void;
  endDemoSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [isDemoSessionActive, setIsDemoSessionActive] = useState(false);

  const startDemoSession = useCallback(() => {
    setIsDemoSessionActive(true);
  }, []);

  const endDemoSession = useCallback(() => {
    setIsDemoSessionActive(false);
  }, []);

  const value = useMemo(
    () => ({ isDemoSessionActive, startDemoSession, endDemoSession }),
    [endDemoSession, isDemoSessionActive, startDemoSession],
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
