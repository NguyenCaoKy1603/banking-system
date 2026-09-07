import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ActivityIndicator, Text } from "react-native";

import { KycScreen } from "@/features/kyc/screens/KycScreen";
import {
  getKycApplication,
  saveKycDraft,
  submitKycApplication,
} from "@/features/kyc/services/kycApi";
import type { KycApplication } from "@/features/kyc/types/kyc";
import { useAuth } from "@/features/auth/context/AuthContext";
import { ApiError } from "@/services/api/ApiError";

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

function queryByTestId(renderer: ReactTestRenderer, testID: string) {
  try {
    return renderer.root.findByProps({ testID });
  } catch {
    return null;
  }
}

async function waitForAssertion(
  assertion: () => void,
  timeoutMs = 2000,
  stepMs = 20,
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
      });
    }
  }
  throw lastError;
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
    pendingRecoveryCodes: null,
    refreshAccessToken: jest.fn().mockResolvedValue("<redacted>"),
    login: jest.fn(),
    register: jest.fn(),
    verifyRegistrationChallenge: jest.fn(),
    resendRegistrationChallenge: jest.fn(),
    completeMfaRevocation: jest.fn(),
    clearPendingRecoveryCodes: jest.fn(),
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

  it("T-KYC-FE-01: Known 422 field errors map to inputs while unknown keys are safely ignored", async () => {
    const renderer = await renderScreen(null);
    act(() => {
      byTestId(renderer, "kyc-full-name").props.onChangeText("Synthetic Applicant");
      byTestId(renderer, "kyc-identity-number").props.onChangeText("123456789012");
      byTestId(renderer, "kyc-address").props.onChangeText("Synthetic address fixture");
      byTestId(renderer, "kyc-select-sample-document").props.onPress();
      byTestId(renderer, "kyc-synthetic-confirmation").props.onValueChange(true);
    });

    submitKycApplicationMock.mockRejectedValueOnce(
      new ApiError({
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Dữ liệu không hợp lệ.",
        fieldErrors: {
          fullName: "Họ tên không đúng định dạng.",
          identityNumber: "Số định danh đã tồn tại trên hồ sơ khác.",
          arbitraryUnknownField: "should_be_ignored",
        },
      }),
    );

    await act(async () => {
      byTestId(renderer, "kyc-submit").props.onPress();
    });

    await waitForAssertion(() => {
      expect(byTestId(renderer, "kyc-full-name").props.error).toBe("Họ tên không đúng định dạng.");
      expect(byTestId(renderer, "kyc-identity-number").props.error).toBe("Số định danh đã tồn tại trên hồ sơ khác.");
    });
    const tree = JSON.stringify(renderer.toJSON());
    expect(tree).toContain("Dữ liệu không hợp lệ.");
    expect(tree).not.toContain("should_be_ignored");

    act(() => renderer.unmount());
  });

  it("T-KYC-FE-02: Initial load failure renders dedicated error view with retry, and prevents double retry", async () => {
    getKycApplicationMock.mockRejectedValueOnce(
      new ApiError({ status: null, code: "NETWORK_ERROR", message: "Mất kết nối mạng." }),
    );
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<KycScreen />);
    });
    await waitForAssertion(() => {
      expect(byTestId(renderer, "kyc-retry-load")).toBeDefined();
    });

    expect(queryByTestId(renderer, "kyc-full-name")).toBeNull();
    expect(byTestId(renderer, "kyc-load-error-message").props.children).toBe(
      "Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền.",
    );

    // Mock successful retry
    let resolveRetry!: (value: KycApplication | null) => void;
    const retryPromise = new Promise<KycApplication | null>((res) => {
      resolveRetry = res;
    });
    getKycApplicationMock.mockReturnValueOnce(retryPromise);

    await act(async () => {
      byTestId(renderer, "kyc-retry-load").props.onPress();
    });

    // While loading, retry button is disabled
    expect(byTestId(renderer, "kyc-retry-load").props.disabled).toBe(true);

    // Complete load
    await act(async () => {
      resolveRetry(existingApplication);
    });

    await waitForAssertion(() => {
      expect(byTestId(renderer, "kyc-full-name")).toBeDefined();
    });

    act(() => renderer.unmount());
  });

  it("T-KYC-FE-03: Renders distinct UI for REJECTED, NEEDS_MORE_INFO, and APPROVED states", async () => {
    // REJECTED
    const rejectedApp: KycApplication = {
      ...existingApplication,
      status: "REJECTED",
      rejectionReason: "Ảnh chụp bị mờ",
    };
    const rendererRejected = await renderScreen(rejectedApp);
    expect(byTestId(rendererRejected, "kyc-rejected-banner")).toBeDefined();
    expect(queryByTestId(rendererRejected, "kyc-needs-more-info-banner")).toBeNull();
    const rejectedText = JSON.stringify(rendererRejected.toJSON());
    expect(rejectedText).toContain("Hồ sơ trước đó đã bị từ chối: Ảnh chụp bị mờ. Lần lưu hoặc nộp tiếp theo sẽ tạo một hồ sơ định danh mới.");
    act(() => rendererRejected.unmount());

    // NEEDS_MORE_INFO
    const needsMoreInfoApp: KycApplication = {
      ...existingApplication,
      status: "NEEDS_MORE_INFO",
      rejectionReason: "Cần bổ sung mặt sau",
    };
    const rendererNeedsMoreInfo = await renderScreen(needsMoreInfoApp);
    expect(byTestId(rendererNeedsMoreInfo, "kyc-needs-more-info-banner")).toBeDefined();
    expect(queryByTestId(rendererNeedsMoreInfo, "kyc-rejected-banner")).toBeNull();
    const needsMoreInfoText = JSON.stringify(rendererNeedsMoreInfo.toJSON());
    expect(needsMoreInfoText).toContain("Ngân hàng yêu cầu bổ sung thông tin: Cần bổ sung mặt sau. Vui lòng cập nhật và nộp lại trên hồ sơ hiện tại.");
    expect(needsMoreInfoText).not.toContain("Hồ sơ trước đó đã bị từ chối");
    act(() => rendererNeedsMoreInfo.unmount());

    // APPROVED
    const approvedApp: KycApplication = {
      ...existingApplication,
      status: "APPROVED",
    };
    const rendererApproved = await renderScreen(approvedApp);
    const approvedText = JSON.stringify(rendererApproved.toJSON());
    expect(approvedText).toContain("Đã duyệt");
    expect(approvedText).toContain("Hồ sơ định danh đã được phê duyệt.");
    expect(queryByTestId(rendererApproved, "kyc-save-draft")).toBeNull();
    expect(queryByTestId(rendererApproved, "kyc-submit")).toBeNull();
    act(() => rendererApproved.unmount());
  });

  it("T-KYC-FE-04: Null or empty rejectionReason uses semantic safe fallback text", async () => {
    // REJECTED with null reason
    const rejectedNull: KycApplication = { ...existingApplication, status: "REJECTED", rejectionReason: null };
    const renderer1 = await renderScreen(rejectedNull);
    const banner1 = byTestId(renderer1, "kyc-rejected-banner");
    const bannerText1 = String(banner1.findAllByType(Text)[1]?.props.children);
    expect(bannerText1).toBe("Hồ sơ trước đó đã bị từ chối: Thông tin định danh chưa đáp ứng tiêu chuẩn đối chiếu. Lần lưu hoặc nộp tiếp theo sẽ tạo một hồ sơ định danh mới.");
    expect(bannerText1).not.toContain("undefined");
    expect(bannerText1).not.toContain("null");
    act(() => renderer1.unmount());

    // NEEDS_MORE_INFO with whitespace reason
    const needsInfoEmpty: KycApplication = { ...existingApplication, status: "NEEDS_MORE_INFO", rejectionReason: "   " };
    const renderer2 = await renderScreen(needsInfoEmpty);
    const banner2 = byTestId(renderer2, "kyc-needs-more-info-banner");
    const bannerText2 = String(banner2.findAllByType(Text)[1]?.props.children);
    expect(bannerText2).toBe("Ngân hàng yêu cầu bổ sung thông tin: Cần cập nhật và hoàn thiện hồ sơ định danh. Vui lòng cập nhật và nộp lại trên hồ sơ hiện tại.");
    expect(bannerText2).not.toContain("undefined");
    expect(bannerText2).not.toContain("null");
    act(() => renderer2.unmount());
  });

  it("T-KYC-FE-05: Handles NETWORK_ERROR, TIMEOUT, and 401 with appropriate user messages", async () => {
    const renderer = await renderScreen(existingApplication);

    // Network error
    saveKycDraftMock.mockRejectedValueOnce(
      new ApiError({ status: null, code: "NETWORK_ERROR", message: "fail" }),
    );
    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain("Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền.");

    // Timeout error
    saveKycDraftMock.mockRejectedValueOnce(
      new ApiError({ status: null, code: "TIMEOUT", message: "fail" }),
    );
    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain("Yêu cầu đến máy chủ đã hết thời gian chờ. Vui lòng thử lại sau.");

    // 401 error
    saveKycDraftMock.mockRejectedValueOnce(
      new ApiError({ status: 401, code: "UNAUTHORIZED", message: "fail" }),
    );
    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");

    act(() => renderer.unmount());
  });

  it("T-KYC-FE-06: New application blocks missing/invalid identity, while existing unchanged identity is omitted", async () => {
    const rendererNew = await renderScreen(null);
    act(() => {
      byTestId(rendererNew, "kyc-full-name").props.onChangeText("Synthetic Applicant");
      byTestId(rendererNew, "kyc-address").props.onChangeText("Synthetic address fixture");
      byTestId(rendererNew, "kyc-select-sample-document").props.onPress();
      byTestId(rendererNew, "kyc-synthetic-confirmation").props.onValueChange(true);
    });
    await act(async () => {
      byTestId(rendererNew, "kyc-save-draft").props.onPress();
    });
    expect(saveKycDraftMock).not.toHaveBeenCalled();
    expect(byTestId(rendererNew, "kyc-identity-number").props.error).toBe("Số định danh mô phỏng gồm 6–24 chữ số.");
    act(() => rendererNew.unmount());

    const rendererExisting = await renderScreen(existingApplication);
    await act(async () => {
      byTestId(rendererExisting, "kyc-save-draft").props.onPress();
    });
    expect(saveKycDraftMock).toHaveBeenCalledTimes(1);
    expect(saveKycDraftMock.mock.calls[0]?.[2]).toEqual({ includeIdentityNumber: false });
    act(() => rendererExisting.unmount());
  });

  it("T-KYC-FE-07: Changed identity sends full new value and rejects masked or last4-only values", async () => {
    const renderer = await renderScreen(existingApplication);

    // Masked value
    act(() => {
      byTestId(renderer, "kyc-identity-number").props.onChangeText("••••9012");
    });
    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });
    expect(saveKycDraftMock).not.toHaveBeenCalled();
    expect(byTestId(renderer, "kyc-identity-number").props.error).toBe("Số định danh mô phỏng gồm 6–24 chữ số.");

    // Last4-only
    act(() => {
      byTestId(renderer, "kyc-identity-number").props.onChangeText("9012");
    });
    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });
    expect(saveKycDraftMock).not.toHaveBeenCalled();

    // Valid 12-digit identity
    act(() => {
      byTestId(renderer, "kyc-identity-number").props.onChangeText(fullIdentity);
    });
    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });
    expect(saveKycDraftMock).toHaveBeenCalledTimes(1);
    expect(saveKycDraftMock.mock.calls[0]?.[0].identityNumber).toBe(fullIdentity);
    expect(saveKycDraftMock.mock.calls[0]?.[2]).toEqual({ includeIdentityNumber: true });

    act(() => renderer.unmount());
  });

  it("T-KYC-FE-08: 409 Conflict triggers canonical reload, and reload failure does not auto-submit", async () => {
    const renderer = await renderScreen(existingApplication);

    saveKycDraftMock.mockRejectedValueOnce(
      new ApiError({ status: 409, code: "CONFLICT", message: "Hồ sơ đang được xử lý." }),
    );
    const submittedCanonical: KycApplication = { ...existingApplication, status: "SUBMITTED" };
    getKycApplicationMock.mockResolvedValueOnce(submittedCanonical);

    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });

    await waitForAssertion(() => {
      expect(getKycApplicationMock).toHaveBeenCalledTimes(2);
    });
    await waitForAssertion(() => {
      expect(queryByTestId(renderer, "kyc-save-draft")).toBeNull();
    });

    // Reload failure does not auto-submit
    const renderer2 = await renderScreen(existingApplication);
    saveKycDraftMock.mockRejectedValueOnce(
      new ApiError({ status: 409, code: "CONFLICT", message: "Hồ sơ đang được xử lý." }),
    );
    getKycApplicationMock.mockRejectedValueOnce(new Error("Network disconnect"));

    await act(async () => {
      byTestId(renderer2, "kyc-save-draft").props.onPress();
    });

    await waitForAssertion(() => {
      expect(JSON.stringify(renderer2.toJSON())).toContain("Xung đột dữ liệu và không thể tải lại hồ sơ. Vui lòng kiểm tra kết nối.");
    });
    expect(submitKycApplicationMock).not.toHaveBeenCalled();

    act(() => renderer.unmount());
    act(() => renderer2.unmount());
  });

  it("T-KYC-FE-09: Save and submit success immediately clears full identity from React state", async () => {
    const renderer = await renderScreen(existingApplication);

    // Save flow
    act(() => {
      byTestId(renderer, "kyc-identity-number").props.onChangeText(fullIdentity);
    });
    expect(byTestId(renderer, "kyc-identity-number").props.value).toBe(fullIdentity);

    await act(async () => {
      byTestId(renderer, "kyc-save-draft").props.onPress();
    });
    expect(byTestId(renderer, "kyc-identity-number").props.value).toBe("");

    // Submit flow
    act(() => {
      byTestId(renderer, "kyc-identity-number").props.onChangeText(fullIdentity);
    });
    expect(byTestId(renderer, "kyc-identity-number").props.value).toBe(fullIdentity);

    await act(async () => {
      byTestId(renderer, "kyc-submit").props.onPress();
    });
    expect(queryByTestId(renderer, "kyc-identity-number")).toBeNull();
    const tree = JSON.stringify(renderer.toJSON());
    expect(tree.includes(fullIdentity)).toBe(false);
    expect(tree).toContain("••••9012");

    act(() => renderer.unmount());
  });

  it("T-KYC-FE-10: Read-only states (SUBMITTED, UNDER_REVIEW, APPROVED) hide action controls", async () => {
    for (const status of ["SUBMITTED", "UNDER_REVIEW", "APPROVED"] as const) {
      const app: KycApplication = { ...existingApplication, status };
      const renderer = await renderScreen(app);

      expect(queryByTestId(renderer, "kyc-save-draft")).toBeNull();
      expect(queryByTestId(renderer, "kyc-submit")).toBeNull();
      expect(queryByTestId(renderer, "kyc-full-name")).toBeNull();

      act(() => renderer.unmount());
    }
  });

  it("T-KYC-FE-GAP-01: renders loading indicator and hides form while initial application load is pending", async () => {
    let resolveApp!: (value: KycApplication | null) => void;
    const pendingPromise = new Promise<KycApplication | null>((resolve) => {
      resolveApp = resolve;
    });
    getKycApplicationMock.mockReturnValue(pendingPromise);

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<KycScreen />);
    });

    expect(renderer.root.findByType(ActivityIndicator)).toBeDefined();
    expect(queryByTestId(renderer, "kyc-full-name")).toBeNull();
    expect(queryByTestId(renderer, "kyc-save-draft")).toBeNull();
    expect(queryByTestId(renderer, "kyc-submit")).toBeNull();
    expect(saveKycDraftMock).not.toHaveBeenCalled();
    expect(submitKycApplicationMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveApp(null);
    });

    await waitForAssertion(() => {
      expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
      expect(byTestId(renderer, "kyc-full-name")).toBeDefined();
    });

    act(() => renderer.unmount());
  });
});
