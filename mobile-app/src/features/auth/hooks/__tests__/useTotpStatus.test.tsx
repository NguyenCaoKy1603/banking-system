import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useTotpStatus } from "@/features/auth/hooks/useTotpStatus";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as authApi from "@/features/auth/services/authApi";

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/auth/services/authApi");

const useAuthMock = jest.mocked(useAuth);
const listMfaMethodsMock = jest.mocked(authApi.listMfaMethods);

let currentRenderer: ReactTestRenderer | null = null;

function TestConsumer({ onResult }: { onResult: (res: ReturnType<typeof useTotpStatus>) => void }) {
  const res = useTotpStatus();
  useEffect(() => {
    onResult(res);
  }, [res, onResult]);
  return null;
}

describe("useTotpStatus hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (currentRenderer) {
      act(() => {
        currentRenderer?.unmount();
      });
      currentRenderer = null;
    }
  });

  it("returns hasActiveTotp = false when items has no active TOTP", async () => {
    useAuthMock.mockReturnValue({
      deviceId: "device-1",
      session: {
        accessToken: "token-1",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 10000,
        sessionEpoch: "epoch-1",
        user: { id: "u-1", fullName: "User", email: "u@test.com", phoneNumber: "0900000000", createdAt: "2026-01-01T00:00:00Z" },
      },
      status: "authenticated",
      isAuthenticated: true,
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });
    listMfaMethodsMock.mockResolvedValueOnce({ items: [] });

    let latestResult!: ReturnType<typeof useTotpStatus>;
    const handleResult = (r: ReturnType<typeof useTotpStatus>) => {
      latestResult = r;
    };

    await act(async () => {
      currentRenderer = create(<TestConsumer onResult={handleResult} />);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestResult.hasActiveTotp).toBe(false);
    expect(latestResult.isLoadingTotp).toBe(false);
  });

  it("returns hasActiveTotp = true when an ACTIVE TOTP credential exists", async () => {
    useAuthMock.mockReturnValue({
      deviceId: "device-1",
      session: {
        accessToken: "token-1",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 10000,
        sessionEpoch: "epoch-1",
        user: { id: "u-1", fullName: "User", email: "u@test.com", phoneNumber: "0900000000", createdAt: "2026-01-01T00:00:00Z" },
      },
      status: "authenticated",
      isAuthenticated: true,
      logoutNotice: null,
      pendingRecoveryCodes: null,
      refreshAccessToken: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      verifyRegistrationChallenge: jest.fn(),
      resendRegistrationChallenge: jest.fn(),
      completeMfaRevocation: jest.fn(),
      clearPendingRecoveryCodes: jest.fn(),
      logout: jest.fn(),
      logoutAll: jest.fn(),
    });
    listMfaMethodsMock.mockResolvedValueOnce({
      items: [
        {
          id: "cred-1",
          customerId: "u-1",
          credentialType: "TOTP",
          displayName: "Authenticator",
          status: "ACTIVE",
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          lastAcceptedTimeStep: null,
          enrolledAt: "2026-01-01T00:00:00Z",
          lastUsedAt: null,
          revokedAt: null,
          compromisedAt: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    let latestResult!: ReturnType<typeof useTotpStatus>;
    const handleResult = (r: ReturnType<typeof useTotpStatus>) => {
      latestResult = r;
    };

    await act(async () => {
      currentRenderer = create(<TestConsumer onResult={handleResult} />);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(latestResult.hasActiveTotp).toBe(true);
    expect(latestResult.isLoadingTotp).toBe(false);
  });
});
