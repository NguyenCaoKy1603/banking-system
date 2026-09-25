import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AssistantScreen } from "@/features/assistant/screens/AssistantScreen";
import { useAuth } from "@/features/auth/context/AuthContext";
import * as assistantApi from "@/features/assistant/api/assistantApi";
import { ApiError } from "@/services/api/ApiError";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockLogout = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/features/assistant/api/assistantApi");

const useAuthMock = jest.mocked(useAuth);
const askAssistantHelpMock = jest.mocked(assistantApi.askAssistantHelp);

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
    currentRenderer = create(<AssistantScreen />);
  });
  return currentRenderer!;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AssistantScreen Component Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      deviceId: "device-test-123",
      session: mockSession,
      status: "authenticated",
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
    });
  });

  afterEach(() => {
    if (currentRenderer) {
      act(() => {
        currentRenderer?.unmount();
      });
      currentRenderer = null;
    }
  });

  it("1. Render đúng tiêu đề, cảnh báo an toàn, ô nhập, các gợi ý và nút Gửi", async () => {
    const renderer = await renderScreen();

    // Cảnh báo an toàn
    const disclaimer = queryByTestId(renderer, "assistant-disclaimer");
    expect(disclaimer).not.toBeNull();

    // Ô nhập câu hỏi
    const input = getTextInput(renderer, "assistant-question-input");
    expect(input.props.value).toBe("");

    // Gợi ý câu hỏi mẫu
    const chip0 = queryByTestId(renderer, "assistant-sample-chip-0");
    expect(chip0).not.toBeNull();

    // Nút Gửi câu hỏi bị disabled khi ô nhập trống
    const sendBtn = getButton(renderer, "assistant-send-button");
    expect(sendBtn.props.disabled).toBe(true);
  });

  it("2. Nhập câu hỏi kích hoạt nút Gửi và cập nhật độ dài ký tự", async () => {
    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Làm sao để xem số dư?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    expect(sendBtn.props.disabled).toBe(false);
  });

  it("3. Chọn câu hỏi gợi ý điền nội dung vào ô nhập", async () => {
    const renderer = await renderScreen();
    const chip0 = getButton(renderer, "assistant-sample-chip-0");

    await act(async () => {
      chip0.props.onPress();
    });

    const input = getTextInput(renderer, "assistant-question-input");
    expect(input.props.value).toBe("Tôi xem và ẩn số dư ở đâu?");

    const sendBtn = getButton(renderer, "assistant-send-button");
    expect(sendBtn.props.disabled).toBe(false);
  });

  it("4. Khóa gửi khi câu hỏi vượt quá 500 ký tự", async () => {
    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    const longQuestion = "x".repeat(501);
    await act(async () => {
      input.props.onChangeText(longQuestion);
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    expect(sendBtn.props.disabled).toBe(true);
  });

  it("5. Gửi câu hỏi thành công hiển thị văn bản trả lời sạch sẽ (không JSON, không metadata)", async () => {
    const cleanAnswer =
      "Trên tab Trang chủ, tìm thẻ đầu tiên trong Tài khoản thanh toán. Chọn biểu tượng Hiện số dư để xem số dư.";
    askAssistantHelpMock.mockResolvedValueOnce({ answer: cleanAnswer });

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Tôi xem số dư ở đâu?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");

    await act(async () => {
      sendBtn.props.onPress();
    });

    expect(askAssistantHelpMock).toHaveBeenCalledTimes(1);
    expect(askAssistantHelpMock).toHaveBeenCalledWith(
      "Tôi xem số dư ở đâu?",
      expect.objectContaining({
        auth: expect.objectContaining({
          accessToken: "access-token-active",
          deviceId: "device-test-123",
        }),
      }),
    );

    // Answer card hiển thị văn bản
    const answerCard = queryByTestId(renderer, "assistant-answer-card");
    expect(answerCard).not.toBeNull();

    const answerText = queryByTestId(renderer, "assistant-answer-text");
    expect(answerText?.props.children).toBe(cleanAnswer);

    // Không còn trạng thái loading
    expect(queryByTestId(renderer, "assistant-loading-state")).toBeNull();
  });

  it("6. Chống double-tap: nhấn nút Gửi liên tiếp chỉ phát một request duy nhất", async () => {
    let resolvePromise: (value: { answer: string }) => void;
    const pendingPromise = new Promise<{ answer: string }>((resolve) => {
      resolvePromise = resolve;
    });
    askAssistantHelpMock.mockReturnValueOnce(pendingPromise);

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Tôi chuyển tiền thế nào?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");

    await act(async () => {
      // Bấm lần 1
      sendBtn.props.onPress();
      // Bấm tiếp lần 2 khi đang pending
      sendBtn.props.onPress();
    });

    // Chỉ có 1 request được dispatch
    expect(askAssistantHelpMock).toHaveBeenCalledTimes(1);

    // Đang loading
    expect(queryByTestId(renderer, "assistant-loading-state")).not.toBeNull();

    // Hoàn tất request
    await act(async () => {
      resolvePromise!({ answer: "Vào mục Chuyển tiền để bắt đầu." });
    });

    expect(queryByTestId(renderer, "assistant-loading-state")).toBeNull();
    expect(queryByTestId(renderer, "assistant-answer-card")).not.toBeNull();
  });

  it("7. Lỗi 422 ASSISTANT_SENSITIVE_INPUT: cảnh báo thông tin nhạy cảm và giữ nguyên câu hỏi", async () => {
    const sensitiveError = new ApiError({
      status: 422,
      code: "ASSISTANT_SENSITIVE_INPUT",
      message: "Request contains sensitive information",
    });
    askAssistantHelpMock.mockRejectedValueOnce(sensitiveError);

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Mật khẩu của tôi là Secret123!");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    await act(async () => {
      sendBtn.props.onPress();
    });

    const errorBanner = queryByTestId(renderer, "assistant-error-banner");
    expect(errorBanner).not.toBeNull();

    const errorMsg = queryByTestId(renderer, "assistant-error-message");
    expect(errorMsg?.props.children).toContain("Câu hỏi chứa thông tin bảo mật");

    // Câu hỏi vẫn được giữ nguyên để người dùng chỉnh sửa
    expect(input.props.value).toBe("Mật khẩu của tôi là Secret123!");
  });

  it("8. Lỗi 429 ASSISTANT_RATE_LIMITED / bận: thông báo chờ và cho phép thử lại thủ công", async () => {
    const rateLimitError = new ApiError({
      status: 429,
      code: "ASSISTANT_RATE_LIMITED",
      message: "Too many requests",
    });
    askAssistantHelpMock.mockRejectedValueOnce(rateLimitError);

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Xem thẻ tín dụng ở đâu?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    await act(async () => {
      sendBtn.props.onPress();
    });

    const errorMsg = queryByTestId(renderer, "assistant-error-message");
    expect(errorMsg?.props.children).toContain("Hệ thống trợ lý đang nhận nhiều yêu cầu");

    // Có nút thử lại
    const retryBtn = queryByTestId(renderer, "assistant-retry-button");
    expect(retryBtn).not.toBeNull();
  });

  it("9. Lỗi 503 ASSISTANT_UNAVAILABLE: thông báo dịch vụ tạm dừng bảo trì", async () => {
    const unavailableError = new ApiError({
      status: 503,
      code: "ASSISTANT_UNAVAILABLE",
      message: "Assistant help service is currently unavailable.",
    });
    askAssistantHelpMock.mockRejectedValueOnce(unavailableError);

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Xem tiền gửi ở đâu?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    await act(async () => {
      sendBtn.props.onPress();
    });

    const errorMsg = queryByTestId(renderer, "assistant-error-message");
    expect(errorMsg?.props.children).toContain("tạm dừng bảo trì");
  });

  it("10. Lỗi 504 / TIMEOUT: thông báo hết thời gian chờ và cho phép thử lại", async () => {
    const timeoutError = new ApiError({
      status: 504,
      code: "TIMEOUT",
      message: "Yêu cầu đến máy chủ đã hết thời gian chờ.",
    });
    askAssistantHelpMock.mockRejectedValueOnce(timeoutError);

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Đăng xuất thiết bị thế nào?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    await act(async () => {
      sendBtn.props.onPress();
    });

    const errorMsg = queryByTestId(renderer, "assistant-error-message");
    expect(errorMsg?.props.children).toContain("hết thời gian chờ từ máy chủ");
  });

  it("11. Lỗi NETWORK_ERROR: thông báo lỗi mạng", async () => {
    const networkError = new ApiError({
      status: null,
      code: "NETWORK_ERROR",
      message: "Không thể kết nối đến máy chủ.",
    });
    askAssistantHelpMock.mockRejectedValueOnce(networkError);

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Mã QR nhận tiền ở đâu?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    await act(async () => {
      sendBtn.props.onPress();
    });

    const errorMsg = queryByTestId(renderer, "assistant-error-message");
    expect(errorMsg?.props.children).toContain("Không thể kết nối đến máy chủ");
  });

  it("12. Lỗi 401: nút Đăng nhập lại logout để route guard mở nhóm đăng nhập", async () => {
    mockLogout.mockResolvedValue({
      localSessionCleared: true,
      remoteRevoked: true,
      recoveryIntentsPreserved: true,
    });
    const authError = new ApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Access token is invalid or expired.",
    });
    askAssistantHelpMock.mockRejectedValueOnce(authError);

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Khóa thẻ khẩn cấp thế nào?");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    await act(async () => {
      sendBtn.props.onPress();
    });

    const reloginBtn = queryByTestId(renderer, "assistant-relogin-button");
    expect(reloginBtn).not.toBeNull();

    await act(async () => {
      reloginBtn?.props.onPress();
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("13. Rời màn hình (unmount) khi request đang xử lý: an toàn, không báo lỗi lên component", async () => {
    let capturedSignal: AbortSignal | undefined;
    askAssistantHelpMock.mockImplementationOnce((_question, options) => {
      capturedSignal = options?.signal;
      return new Promise<{ answer: string }>(() => {}); // Never resolves
    });

    const renderer = await renderScreen();
    const input = getTextInput(renderer, "assistant-question-input");

    await act(async () => {
      input.props.onChangeText("Câu hỏi kiểm tra unmount");
    });

    const sendBtn = getButton(renderer, "assistant-send-button");
    await act(async () => {
      sendBtn.props.onPress();
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Unmount màn hình khi request đang in-flight
    await act(async () => {
      renderer.unmount();
    });

    // AbortController đã kích hoạt abort
    expect(capturedSignal?.aborted).toBe(true);
  });
});
