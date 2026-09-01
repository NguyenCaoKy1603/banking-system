import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { KycScreen } from "@/features/kyc/screens/KycScreen";
import {
  getKycApplication,
  saveKycDraft,
  submitKycApplication,
} from "@/features/kyc/services/kycApi";
import type { KycApplication } from "@/features/kyc/types/kyc";
import { useAuth } from "@/features/auth/context/AuthContext";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/kyc/services/kycApi", () => ({
  getKycApplication: jest.fn(),
  saveKycDraft: jest.fn(),
  submitKycApplication: jest.fn(),
}));

const getKycApplicationMock = jest.mocked(getKycApplication);
const saveKycDraftMock = jest.mocked(saveKycDraft);
const submitKycApplicationMock = jest.mocked(submitKycApplication);
const useAuthMock = jest.mocked(useAuth);

const fullIdentity = "123456789012";
const session = {
  accessToken: "<redacted>",
  refreshToken: "<redacted>",
  accessTokenExpiresAt: Date.now() + 60_000,
  sessionEpoch: "<redacted>",
  user: {
    id: "22222222-2222-4222-8222-222222222222",
    fullName: "Synthetic Applicant",
    email: "synthetic@example.test",
    phoneNumber: "<redacted>",
    createdAt: "2026-09-02T00:00:00.000Z",
  },
};

const existingApplication: KycApplication = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: session.user.id,
  fullName: session.user.fullName,
  identityNumberLast4: "9012",
  address: "Synthetic address fixture",
  documentUri: "mock://identity-card-front",
  status: "DRAFT",
  rejectionReason: null,
  submittedAt: null,
  updatedAt: "2026-09-02T00:00:00.000Z",
  version: 1,
};

function createResponseApplication(status: KycApplication["status"] = "DRAFT"): KycApplication {
  return { ...existingApplication, status };
}

async function renderScreen(application: KycApplication | null): Promise<ReactTestRenderer> {
  getKycApplicationMock.mockResolvedValue(application);
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<KycScreen />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.clearAllMocks();
  useAuthMock.mockReturnValue({
    status: "authenticated",
    session,
    logoutNotice: null,
    deviceId: "<redacted>",
    isAuthenticated: true,
    refreshAccessToken: jest.fn().mockResolvedValue("<redacted>"),
    login: jest.fn(),
    register: jest.fn(),
    verifyRegistrationChallenge: jest.fn(),
    resendRegistrationChallenge: jest.fn(),
    logout: jest.fn(),
    logoutAll: jest.fn(),
  });
  saveKycDraftMock.mockResolvedValue(createResponseApplication());
  submitKycApplicationMock.mockResolvedValue(createResponseApplication("SUBMITTED"));
});

describe("KycScreen identity contract", () => {
  it("renders an existing identity as masked last4 and never renders the full identity", async () => {
    const renderer = await renderScreen(existingApplication);

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree.includes(fullIdentity)).toBe(false);
    expect(tree).toContain("••••9012");
    expect(byTestId(renderer, "kyc-identity-last4-summary")).toBeDefined();

    act(() => renderer.unmount());
  });

  it("omits identityNumber for an unchanged existing identity update", async () => {
    const renderer = await renderScreen(existingApplication);

    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
      await Promise.resolve();
    });

    expect(saveKycDraftMock).toHaveBeenCalledTimes(1);
    expect(saveKycDraftMock.mock.calls[0]?.[0].identityNumber).toBe("");
    expect(saveKycDraftMock.mock.calls[0]?.[2]).toEqual({ includeIdentityNumber: false });

    act(() => renderer.unmount());
  });

  it("sends a newly entered full identity only after the user changes identity", async () => {
    const renderer = await renderScreen(existingApplication);

    act(() => {
      byTestId(renderer, "kyc-identity-number").props.onChangeText(fullIdentity);
    });
    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
      await Promise.resolve();
    });

    expect(saveKycDraftMock).toHaveBeenCalledTimes(1);
    expect(/^\d{6,24}$/.test(String(saveKycDraftMock.mock.calls[0]?.[0].identityNumber))).toBe(true);
    expect(saveKycDraftMock.mock.calls[0]?.[2]).toEqual({ includeIdentityNumber: true });

    const tree = JSON.stringify(renderer.toJSON());
    expect(tree.includes(fullIdentity)).toBe(false);

    act(() => renderer.unmount());
  });

  it("blocks a new application without identity before calling the service", async () => {
    const renderer = await renderScreen(null);

    act(() => {
      byTestId(renderer, "kyc-full-name").props.onChangeText("Synthetic Applicant");
      byTestId(renderer, "kyc-address").props.onChangeText("Synthetic address fixture");
      byTestId(renderer, "kyc-select-sample-document").props.onPress();
      byTestId(renderer, "kyc-synthetic-confirmation").props.onValueChange(true);
    });
    await act(async () => {
      byTestId(renderer, "kyc-submit").props.onPress();
      await Promise.resolve();
    });

    expect(submitKycApplicationMock).not.toHaveBeenCalled();
    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain("Số định danh mô phỏng gồm 6–24 chữ số.");
    expect(tree.includes(fullIdentity)).toBe(false);

    act(() => renderer.unmount());
  });
});
