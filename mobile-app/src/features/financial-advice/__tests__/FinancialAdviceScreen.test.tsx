import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { FinancialAdviceScreen } from "@/features/financial-advice/screens/FinancialAdviceScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as financialAdviceApi from "@/features/financial-advice/api/financialAdviceApi";
import { ApiError } from "@/services/api/ApiError";
import type { FinancialAdviceResponse } from "@/features/financial-advice/types/financialAdvice";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBack = jest.fn();
const mockLogout = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ back: mockBack }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/financial-advice/api/financialAdviceApi", () => {
  const actual = jest.requireActual("@/features/financial-advice/api/financialAdviceApi");
  return {
    ...actual,
    getFinancialAdvice: jest.fn(),
  };
});

const useAuthMock = jest.mocked(useAuth);
const getFinancialAdviceMock = jest.mocked(financialAdviceApi.getFinancialAdvice);

// ─── Fixtures & Helpers ──────────────────────────────────────────────────────

const mockSession = {
  accessToken: "access-token-active",
  refreshToken: "refresh-token-active",
  accessTokenExpiresAt: Date.now() + 900_000,
  sessionEpoch: "epoch-1",
  user: {
    id: "customer-1",
    fullName: "Nguyễn Văn A",
    email: "vana@example.com",
    phoneNumber: "0901234567",
    createdAt: "2026-01-01T00:00:00Z",
  },
};

function authenticatedAuthState(session = mockSession) {
  return {
    deviceId: "device-test-123",
    session,
    status: "authenticated" as const,
    isAuthenticated: true,
    logoutNotice: null,
    pendingRecoveryCodes: null,
    refreshAccessToken: jest.fn(),
    logout: mockLogout,
    login: jest.fn(),
    register: jest.fn(),
    verifyRegistrationChallenge: jest.fn(),
    resendRegistrationChallenge: jest.fn(),
    completeMfaRevocation: jest.fn(),
    clearPendingRecoveryCodes: jest.fn(),
    logoutAll: jest.fn(),
  };
}

const mockSavingsResponse: FinancialAdviceResponse = {
  schemaVersion: "1",
  kind: "SAVINGS_PLAN",
  currency: "VND",
  source: "USER_ENTERED",
  calculationVersion: "fa-calc-v1",
  catalogVersion: "fa-catalog-v2",
  budgetStatus: "SURPLUS",
  goalStatus: "GAP",
  metrics: {
    declaredOutgoingsMinor: "8500000",
    unallocatedBeforeBufferMinor: "1500000",
    capacityAfterBufferMinor: "1500000",
    bufferShortfallMinor: "0",
    remainingGoalMinor: "10000000",
    requiredMonthlySavingsMinor: "2000000",
    monthlyGapMinor: "500000",
    achievableGoalAtDeadlineMinor: "9500000",
    suggestedMonths: 7,
    horizonExceeded: false,
  },
  options: [
    {
      id: "EXTEND_DEADLINE",
      title: "Kéo dài thời gian",
      description: "Theo số liệu đã nhập, cần khoảng 7 tháng để dành phần còn thiếu.",
      changes: { months: 7 },
    },
    {
      id: "REDUCE_FLEXIBLE_SPENDING",
      title: "Giảm chi tiêu linh hoạt",
      description: "Cân nhắc giảm chi linh hoạt nếu phù hợp.",
      changes: { reductionMinor: "500000", newFlexibleExpensesMinor: "1500000" },
    },
  ],
  preferredOptionId: "EXTEND_DEADLINE",
  explanation: {
    mode: "AI_ASSISTED",
    reasonIds: ["MONTHLY_GAP", "PRESERVE_CURRENT_SPENDING"],
    paragraphs: [
      "Với thu nhập 10.000.000 ₫ và tổng chi 8.500.000 ₫, khả năng tích lũy của bạn là 1.500.000 ₫/tháng.",
      "Bạn ưu tiên giữ mức chi, do đó phương án kéo dài thêm 2 tháng là lựa chọn phù hợp nhất.",
    ],
    fallbackReason: null,
  },
  assumptions: [
    "Dữ liệu phân tích cho một tháng đại diện do bạn cung cấp.",
    "Chưa tính các biến động bất thường ngoài các khoản đã nhập.",
  ],
  warnings: [
    {
      code: "BUFFER_NOT_COVERED",
      message: "Chưa bảo đảm đủ khoản giữ lại dự phòng.",
    },
  ],
};

let currentRenderer: ReactTestRenderer | null = null;

function getTextInput(renderer: ReactTestRenderer, testID: string) {
  const nodes = renderer.root.findAllByProps({ testID });
  const input = nodes.find((node) => typeof node.props.onChangeText === "function");
  if (!input) {
    throw new Error(`TextInput not found for testID: ${testID}`);
  }
  return input;
}

function getButton(renderer: ReactTestRenderer, testID: string) {
  const nodes = renderer.root.findAllByProps({ testID });
  const button = nodes.find((node) => typeof node.props.onPress === "function");
  if (!button) {
    throw new Error(`Button not found for testID: ${testID}`);
  }
  return button;
}

function queryByTestId(renderer: ReactTestRenderer, testID: string) {
  const nodes = renderer.root.findAllByProps({ testID });
  return nodes.length > 0 ? nodes[0] : null;
}

async function renderScreen() {
  await act(async () => {
    currentRenderer = create(<FinancialAdviceScreen />);
  });
  return currentRenderer!;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FinancialAdviceScreen Component Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue(authenticatedAuthState());
  });

  it("1. Render form ban đầu với đầy đủ các trường và testIDs", async () => {
    const renderer = await renderScreen();

    expect(queryByTestId(renderer, "fa-kind-savings")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-kind-budget")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-income")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-essential")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-flexible")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-debt-payment")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-buffer")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-goal-target")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-goal-saved")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-goal-months")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-preference-target")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-preference-spending")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-preference-balanced")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-confirm-input")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-submit")).not.toBeNull();
  });

  it("2. Chuyển tab sang Cân đối ngân sách: hiển thị fa-monthly-savings-target và ẩn goal fields", async () => {
    const renderer = await renderScreen();

    const budgetTab = getButton(renderer, "fa-kind-budget");
    await act(async () => {
      budgetTab.props.onPress();
    });

    expect(queryByTestId(renderer, "fa-monthly-savings-target")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-goal-target")).toBeNull();
  });

  it("3. Báo lỗi validation trên UI khi submit mà chưa điền trường bắt buộc", async () => {
    const renderer = await renderScreen();

    const submitBtn = getButton(renderer, "fa-submit");
    await act(async () => {
      submitBtn.props.onPress();
    });

    // Không gọi API vì có lỗi validate
    expect(getFinancialAdviceMock).not.toHaveBeenCalled();
  });

  it("4. Submit form SAVINGS_PLAN thành công: hiển thị kết quả, metrics, options và warnings", async () => {
    getFinancialAdviceMock.mockResolvedValueOnce(mockSavingsResponse);

    const renderer = await renderScreen();

    // Điền dữ liệu form
    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });

    const submitBtn = getButton(renderer, "fa-submit");
    await act(async () => {
      submitBtn.props.onPress();
    });

    expect(getFinancialAdviceMock).toHaveBeenCalledTimes(1);

    // Kiểm tra các phần tử trên màn hình kết quả
    expect(queryByTestId(renderer, "fa-result")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-result-mode")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-required-monthly")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-capacity")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-gap")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-option-extend")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-option-cut-flexible")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-warning")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-edit-input")).not.toBeNull();
  });

  it("5. Nhấn Chỉnh sửa số liệu: quay về form nhập và giữ nguyên giá trị", async () => {
    getFinancialAdviceMock.mockResolvedValueOnce(mockSavingsResponse);

    const renderer = await renderScreen();

    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });

    const submitBtn = getButton(renderer, "fa-submit");
    await act(async () => {
      submitBtn.props.onPress();
    });

    expect(queryByTestId(renderer, "fa-result")).not.toBeNull();

    const editBtn = getButton(renderer, "fa-edit-input");
    await act(async () => {
      editBtn.props.onPress();
    });

    expect(queryByTestId(renderer, "fa-result")).toBeNull();
    expect(queryByTestId(renderer, "fa-income")).not.toBeNull();
    expect(getTextInput(renderer, "fa-income").props.value).toBe("10.000.000");
  });

  it("6. Xử lý lỗi 429 Rate limit: hiển thị thông báo bận và nút thử lại", async () => {
    getFinancialAdviceMock.mockRejectedValueOnce(
      new ApiError({
        message: "Quá nhiều yêu cầu",
        status: 429,
        code: "RATE_LIMITED",
      }),
    );

    const renderer = await renderScreen();

    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });

    const submitBtn = getButton(renderer, "fa-submit");
    await act(async () => {
      submitBtn.props.onPress();
    });

    expect(queryByTestId(renderer, "fa-error")).not.toBeNull();
    expect(queryByTestId(renderer, "fa-retry")).not.toBeNull();
  });

  it("7. Xử lý lỗi 401 Unauthorized: hiển thị nút Đăng nhập lại và gọi logout()", async () => {
    getFinancialAdviceMock.mockRejectedValueOnce(
      new ApiError({
        message: "Phiên hết hạn",
        status: 401,
        code: "UNAUTHORIZED",
      }),
    );

    const renderer = await renderScreen();

    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });

    const submitBtn = getButton(renderer, "fa-submit");
    await act(async () => {
      submitBtn.props.onPress();
    });

    const reloginBtn = queryByTestId(renderer, "fa-relogin-button");
    expect(reloginBtn).not.toBeNull();

    await act(async () => {
      reloginBtn?.props.onPress();
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("8. Lifecycle Guard: unmount khi request đang bay không gây lỗi và kích hoạt abort", async () => {
    let capturedSignal: AbortSignal | undefined;
    getFinancialAdviceMock.mockImplementationOnce((_req, options) => {
      capturedSignal = options?.signal;
      return new Promise<FinancialAdviceResponse>(() => {}); // Never resolves
    });

    const renderer = await renderScreen();

    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });

    const submitBtn = getButton(renderer, "fa-submit");
    await act(async () => {
      submitBtn.props.onPress();
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    await act(async () => {
      renderer.unmount();
    });

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("9. U-01: double-submit trong lúc request pending chỉ gọi API một lần", async () => {
    let resolveRequest!: (response: FinancialAdviceResponse) => void;
    getFinancialAdviceMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const renderer = await renderScreen();

    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });

    await act(async () => {
      getButton(renderer, "fa-submit").props.onPress();
      getButton(renderer, "fa-submit").props.onPress();
    });
    expect(getFinancialAdviceMock).toHaveBeenCalledTimes(1);
    expect(getButton(renderer, "fa-submit").props.disabled).toBe(true);

    await act(async () => resolveRequest(mockSavingsResponse));
    expect(queryByTestId(renderer, "fa-result")).not.toBeNull();
  });

  it("10. U-06: response cũ sau login lại cùng user với epoch mới không hiển thị", async () => {
    let resolveRequest!: (response: FinancialAdviceResponse) => void;
    let capturedSignal: AbortSignal | undefined;
    getFinancialAdviceMock.mockImplementationOnce((_request, options) => {
      capturedSignal = options?.signal;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    });
    const renderer = await renderScreen();

    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });
    await act(async () => {
      getButton(renderer, "fa-submit").props.onPress();
    });

    useAuthMock.mockReturnValue(authenticatedAuthState({
      ...mockSession,
      sessionEpoch: "epoch-2-same-user",
    }));
    await act(async () => renderer.update(<FinancialAdviceScreen />));
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => resolveRequest(mockSavingsResponse));
    expect(queryByTestId(renderer, "fa-result")).toBeNull();
    expect(queryByTestId(renderer, "fa-error")).toBeNull();
  });

  it("11. U-07: lỗi 401 muộn của epoch cũ không tác động phiên mới", async () => {
    let rejectRequest!: (error: unknown) => void;
    getFinancialAdviceMock.mockReturnValueOnce(new Promise((_, reject) => {
      rejectRequest = reject;
    }));
    const renderer = await renderScreen();

    await act(async () => {
      getTextInput(renderer, "fa-income").props.onChangeText("10.000.000");
      getTextInput(renderer, "fa-essential").props.onChangeText("6.000.000");
      getTextInput(renderer, "fa-flexible").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-debt-payment").props.onChangeText("500.000");
      getTextInput(renderer, "fa-buffer").props.onChangeText("0");
      getTextInput(renderer, "fa-goal-target").props.onChangeText("12.000.000");
      getTextInput(renderer, "fa-goal-saved").props.onChangeText("2.000.000");
      getTextInput(renderer, "fa-goal-months").props.onChangeText("5");
      getButton(renderer, "fa-confirm-input").props.onPress();
    });
    await act(async () => {
      getButton(renderer, "fa-submit").props.onPress();
    });

    useAuthMock.mockReturnValue(authenticatedAuthState({
      ...mockSession,
      sessionEpoch: "epoch-2-new-user",
      user: { ...mockSession.user, id: "customer-2" },
    }));
    await act(async () => renderer.update(<FinancialAdviceScreen />));
    await act(async () => rejectRequest(new ApiError({
      message: "Stale unauthorized response",
      status: 401,
      code: "UNAUTHORIZED",
    })));

    expect(queryByTestId(renderer, "fa-error")).toBeNull();
    expect(queryByTestId(renderer, "fa-relogin-button")).toBeNull();
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
