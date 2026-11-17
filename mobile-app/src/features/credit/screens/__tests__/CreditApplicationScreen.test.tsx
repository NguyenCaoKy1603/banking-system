import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { CreditApplicationScreen } from "@/features/credit/screens/CreditApplicationScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useTotpStatus } from "@/features/auth/hooks/useTotpStatus";
import { createOtpChallenge } from "@/features/auth/services/otpApi";
import { listCreditApplications } from "@/features/credit/services/creditApi";
import { getKycApplication } from "@/features/kyc/services/kycApi";
import type { KycApplication } from "@/features/kyc/types/kyc";

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => {
  const React = jest.requireActual("react");
  return {
    useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }),
    useFocusEffect: (callback: () => void) => {
      React.useEffect(() => {
        callback();
      }, [callback]);
    },
  };
});

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(async () => "sha256-digest"),
  randomUUID: jest.fn(() => "11111111-1111-4111-8111-111111111111"),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/auth/hooks/useTotpStatus", () => ({
  useTotpStatus: jest.fn(),
}));

jest.mock("@/features/auth/services/otpApi", () => ({
  createOtpChallenge: jest.fn(),
}));

jest.mock("@/features/credit/services/creditApi", () => ({
  listCreditApplications: jest.fn(),
  submitCreditApplication: jest.fn(),
  activateCreditApplication: jest.fn(),
}));

jest.mock("@/features/kyc/services/kycApi", () => ({
  getKycApplication: jest.fn(),
}));

const useAuthMock = jest.mocked(useAuth);
const useTotpStatusMock = jest.mocked(useTotpStatus);
const createOtpChallengeMock = jest.mocked(createOtpChallenge);
const listCreditApplicationsMock = jest.mocked(listCreditApplications);
const getKycApplicationMock = jest.mocked(getKycApplication);

let renderer: ReactTestRenderer | null = null;

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function makeKycApplication(status: KycApplication["status"]): KycApplication {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    fullName: "Nguyen Van A",
    identityNumberLast4: "1234",
    address: "TP.HCM",
    documentUri: "mock://identity-card-front",
    status,
    rejectionReason: null,
    submittedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
  };
}

describe("CreditApplicationScreen KYC gating", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      status: "authenticated",
      isAuthenticated: true,
      deviceId: "device-1",
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
      session: {
        accessToken: "token-1",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 60_000,
        sessionEpoch: "epoch-1",
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          fullName: "Nguyen Van A",
          email: "user@example.test",
          phoneNumber: "0900000001",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      },
    });
    useTotpStatusMock.mockReturnValue({
      hasActiveTotp: true,
      isLoadingTotp: false,
      refreshTotpStatus: jest.fn(),
    });
    listCreditApplicationsMock.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  it("blocks credit submission when KYC is not approved and navigates to /kyc", async () => {
    getKycApplicationMock.mockResolvedValue(makeKycApplication("SUBMITTED"));

    act(() => {
      renderer = create(<CreditApplicationScreen />);
    });
    await flushMicrotasks();

    expect(renderer!.root.findByProps({ testID: "credit-app-kyc-notice" })).toBeTruthy();
    const submitButton = renderer!.root.findByProps({ testID: "credit-application-submit" });
    expect(submitButton.props.disabled).toBe(true);

    await act(async () => {
      submitButton.props.onPress();
    });
    expect(createOtpChallengeMock).not.toHaveBeenCalled();

    const kycActionButton = renderer!.root.findByProps({ testID: "credit-app-kyc-action" });
    act(() => {
      kycActionButton.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith("/kyc");
  });

  it("allows submitting credit application when KYC is APPROVED", async () => {
    getKycApplicationMock.mockResolvedValue(makeKycApplication("APPROVED"));
    createOtpChallengeMock.mockResolvedValue({
      challengeId: "33333333-3333-4333-8333-333333333333",
      purpose: "CREDIT_APPLICATION",
      methods: ["TOTP"],
      expiresAt: "2026-09-01T01:00:00.000Z",
    });

    act(() => {
      renderer = create(<CreditApplicationScreen />);
    });
    await flushMicrotasks();

    expect(() => renderer!.root.findByProps({ testID: "credit-app-kyc-notice" })).toThrow();
    const submitButton = renderer!.root.findByProps({ testID: "credit-application-submit" });
    expect(submitButton.props.disabled).toBe(false);

    await act(async () => {
      submitButton.props.onPress();
    });
    await flushMicrotasks();

    expect(createOtpChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "CREDIT_APPLICATION" }),
      expect.objectContaining({ accessToken: "token-1", deviceId: "device-1" }),
    );
    expect(renderer!.root.findByProps({ testID: "credit-application-otp" })).toBeTruthy();
  });
});
