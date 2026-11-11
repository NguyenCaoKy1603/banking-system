import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/features/auth/context/AuthContext";
import { listMfaMethods } from "@/features/auth/services/authApi";

export function useTotpStatus() {
  const { deviceId, refreshAccessToken, session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const [hasActiveTotp, setHasActiveTotp] = useState<boolean | null>(null);
  const [isLoadingTotp, setIsLoadingTotp] = useState(Boolean(accessToken && deviceId));

  const checkTotp = useCallback(async () => {
    if (!accessToken || !deviceId) {
      setHasActiveTotp(null);
      setIsLoadingTotp(false);
      return;
    }
    setIsLoadingTotp(true);
    try {
      const response = await listMfaMethods({
        accessToken,
        deviceId,
        refreshAccessToken,
      });
      const hasActive = response.items.some(
        (m) => m.status === "ACTIVE" && m.credentialType === "TOTP",
      );
      setHasActiveTotp(hasActive);
    } catch {
      // Non-blocking fail-safe: retain current state on error
    } finally {
      setIsLoadingTotp(false);
    }
  }, [accessToken, deviceId, refreshAccessToken]);

  useEffect(() => {
    let isMounted = true;
    if (!accessToken || !deviceId) {
      return;
    }
    void listMfaMethods({
      accessToken,
      deviceId,
      refreshAccessToken,
    })
      .then((response) => {
        if (isMounted) {
          const hasActive = response.items.some(
            (m) => m.status === "ACTIVE" && m.credentialType === "TOTP",
          );
          setHasActiveTotp(hasActive);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsLoadingTotp(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, deviceId, refreshAccessToken]);

  return { hasActiveTotp, isLoadingTotp, refreshTotpStatus: checkTotp };
}
