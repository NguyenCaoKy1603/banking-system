import {
  askAssistantHelp,
  ASSISTANT_CLIENT_TIMEOUT_MS,
} from "@/features/assistant/api/assistantApi";
import {
  countCodePoints,
  isAssistantHelpResponse,
  MAX_QUESTION_CODE_POINTS,
} from "@/features/assistant/types/assistant";
import * as httpClient from "@/services/api/httpClient";

jest.mock("@/services/api/httpClient", () => ({
  requestJson: jest.fn(),
}));

const requestJsonMock = jest.mocked(httpClient.requestJson);

describe("assistantApi", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("countCodePoints", () => {
    it("đếm chính xác số lượng Unicode code points cho tiếng Việt và ký tự đặc biệt", () => {
      expect(countCodePoints("")).toBe(0);
      expect(countCodePoints("Xin chào")).toBe(8);
      // Emoji và ký tự nhiều byte
      expect(countCodePoints("Chào bạn 👋")).toBe(10);
    });
  });

  describe("isAssistantHelpResponse", () => {
    it("chấp nhận đối tượng hợp lệ có trường answer dạng string", () => {
      expect(isAssistantHelpResponse({ answer: "Hướng dẫn xem số dư..." })).toBe(true);
      expect(isAssistantHelpResponse({ answer: "" })).toBe(true);
    });

    it("từ chối các giá trị không đúng schema", () => {
      expect(isAssistantHelpResponse(null)).toBe(false);
      expect(isAssistantHelpResponse(undefined)).toBe(false);
      expect(isAssistantHelpResponse("chỉ là chuỗi")).toBe(false);
      expect(isAssistantHelpResponse([])).toBe(false);
      expect(isAssistantHelpResponse({})).toBe(false);
      expect(isAssistantHelpResponse({ answer: 123 })).toBe(false);
      expect(isAssistantHelpResponse({ answer: null })).toBe(false);
      expect(isAssistantHelpResponse({ answer: {} })).toBe(false);
    });
  });

  describe("askAssistantHelp", () => {
    it("gửi request tới /assistant/help với method POST và body chuẩn hóa", async () => {
      const mockResponse = { answer: "Vào mục Quản lý để xem lịch sử." };
      requestJsonMock.mockResolvedValueOnce(mockResponse);

      const auth = { accessToken: "test-token", deviceId: "device-123" };
      const controller = new AbortController();

      const result = await askAssistantHelp("  Tôi xem lịch sử giao dịch ở đâu?   ", {
        auth,
        signal: controller.signal,
      });

      expect(result).toEqual(mockResponse);
      expect(requestJsonMock).toHaveBeenCalledTimes(1);
      expect(requestJsonMock).toHaveBeenCalledWith(
        "/assistant/help",
        {
          method: "POST",
          body: { question: "Tôi xem lịch sử giao dịch ở đâu?" },
          auth,
          signal: controller.signal,
          timeoutMs: ASSISTANT_CLIENT_TIMEOUT_MS,
          retryOnUnauthorized: true,
        },
        isAssistantHelpResponse,
      );
    });

    it("cho phép ghi đè timeoutMs riêng khi cần", async () => {
      requestJsonMock.mockResolvedValueOnce({ answer: "OK" });

      await askAssistantHelp("Xem số dư", { timeoutMs: 40_000 });

      expect(requestJsonMock).toHaveBeenCalledWith(
        "/assistant/help",
        expect.objectContaining({
          timeoutMs: 40_000,
        }),
        isAssistantHelpResponse,
      );
    });

    it("từ chối ngay câu hỏi rỗng hoặc chỉ chứa khoảng trắng mà không gọi mạng", async () => {
      await expect(askAssistantHelp("   ")).rejects.toThrow(
        "Vui lòng nhập câu hỏi trước khi gửi.",
      );
      await expect(askAssistantHelp("")).rejects.toThrow(
        "Vui lòng nhập câu hỏi trước khi gửi.",
      );
      expect(requestJsonMock).not.toHaveBeenCalled();
    });

    it("từ chối ngay câu hỏi vượt quá 500 Unicode code points mà không gọi mạng", async () => {
      const longQuestion = "a".repeat(MAX_QUESTION_CODE_POINTS + 1);

      await expect(askAssistantHelp(longQuestion)).rejects.toThrow(
        `Câu hỏi vượt quá giới hạn cho phép (501/${MAX_QUESTION_CODE_POINTS} ký tự). Vui lòng rút ngắn câu hỏi.`,
      );
      expect(requestJsonMock).not.toHaveBeenCalled();
    });

    it("chấp nhận câu hỏi đúng 500 code points", async () => {
      const exactQuestion = "a".repeat(MAX_QUESTION_CODE_POINTS);
      requestJsonMock.mockResolvedValueOnce({ answer: "Đã xử lý." });

      const result = await askAssistantHelp(exactQuestion);
      expect(result.answer).toBe("Đã xử lý.");
      expect(requestJsonMock).toHaveBeenCalledTimes(1);
    });
  });
});
