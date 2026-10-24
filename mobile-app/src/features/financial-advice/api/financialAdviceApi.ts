import { requestJson, type RequestAuth } from "@/services/api/httpClient";
import { ApiError } from "@/services/api/ApiError";
import type {
  FinancialAdviceRequest,
  FinancialAdviceResponse,
} from "@/features/financial-advice/types/financialAdvice";
import { isFinancialAdviceResponse } from "@/features/financial-advice/validation/financialAdviceValidators";

export const FINANCIAL_ADVICE_CLIENT_TIMEOUT_MS = 35_000;

export type GetFinancialAdviceOptions = {
  auth?: RequestAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type MappedFinancialAdviceError = {
  title: string;
  message: string;
  isAuth?: boolean;
  isRateLimited?: boolean;
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string>;
};

/**
 * Gửi yêu cầu tư vấn tài chính tới Backend endpoint POST /api/v1/assistant/financial-advice.
 */
export async function getFinancialAdvice(
  request: FinancialAdviceRequest,
  options: GetFinancialAdviceOptions = {},
): Promise<FinancialAdviceResponse> {
  return requestJson<FinancialAdviceResponse>(
    "/assistant/financial-advice",
    {
      method: "POST",
      body: request,
      auth: options.auth,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? FINANCIAL_ADVICE_CLIENT_TIMEOUT_MS,
      retryOnUnauthorized: true,
    },
    isFinancialAdviceResponse,
  );
}

/**
 * Chuyển đổi lỗi từ API hoặc mạng thành thông báo thân thiện cho giao diện người dùng.
 */
export function mapFinancialAdviceError(error: unknown): MappedFinancialAdviceError {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        title: "Phiên đăng nhập hết hạn",
        message:
          "Vui lòng đăng nhập lại để tiếp tục sử dụng tính năng tư vấn tài chính.",
        isAuth: true,
      };
    }

    if (error.status === 413 || error.code === "FINANCIAL_ADVICE_BODY_TOO_LARGE") {
      return {
        title: "Dữ liệu quá lớn",
        message:
          "Thông tin gửi lên vượt quá giới hạn cho phép. Vui lòng rút gọn dữ liệu.",
      };
    }

    if (error.status === 422 || error.code === "VALIDATION_ERROR") {
      const fieldErrors =
        error.fieldErrors && typeof error.fieldErrors === "object"
          ? Object.fromEntries(Object.entries(error.fieldErrors as Record<string, string>).map(([key, value]) => {
              const mobileKey = key.startsWith("goal.") ? key.slice("goal.".length) : key;
              return [mobileKey, value];
            }))
          : undefined;
      return {
        title: "Dữ liệu không hợp lệ",
        message:
          error.message ||
          "Một số thông tin nhập vào chưa đúng định dạng. Vui lòng kiểm tra lại.",
        fieldErrors,
      };
    }

    if (
      error.status === 429 ||
      error.code === "ASSISTANT_RATE_LIMITED" ||
      error.code === "RATE_LIMITED"
    ) {
      return {
        title: "Hệ thống đang bận",
        message:
          "Bạn đã gửi quá nhiều yêu cầu tư vấn trong thời gian ngắn. Vui lòng chờ ít phút rồi thử lại.",
        isRateLimited: true,
      };
    }

    if (
      error.status === 503 ||
      error.code === "FINANCIAL_ADVICE_UNAVAILABLE" ||
      error.code === "ASSISTANT_UNAVAILABLE"
    ) {
      return {
        title: "Tính năng tạm dừng",
        message:
          "Dịch vụ tư vấn tài chính hiện đang tạm dừng bảo trì. Vui lòng thử lại sau.",
      };
    }

    if (
      error.status === 504 ||
      error.code === "FINANCIAL_ADVICE_TIMEOUT" ||
      error.code === "TIMEOUT"
    ) {
      return {
        title: "Hết thời gian chờ",
        message:
          "Yêu cầu xử lý đã hết thời gian chờ từ máy chủ. Bạn có thể nhấn thử lại.",
      };
    }

    if (error.code === "NETWORK_ERROR") {
      return {
        title: "Lỗi kết nối mạng",
        message:
          "Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng của bạn.",
      };
    }

    if (error.code === "REQUEST_ABORTED") {
      return {
        title: "Yêu cầu đã hủy",
        message: "Yêu cầu tư vấn tài chính đã được hủy.",
      };
    }

    return {
      title: "Không thể nhận tư vấn",
      message:
        error.message ||
        "Đã xảy ra lỗi trong quá trình phân tích. Vui lòng thử lại sau.",
    };
  }

  if (error instanceof Error) {
    return {
      title: "Không thể xử lý yêu cầu",
      message: error.message,
    };
  }

  return {
    title: "Lỗi không xác định",
    message: "Không thể thực hiện tư vấn lúc này. Vui lòng thử lại sau.",
  };
}
