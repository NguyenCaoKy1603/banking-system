import { ApiError } from "@/services/api/ApiError";

export type RequestErrorKind = "offline" | "timeout" | "cancelled" | "generic";

export type RequestErrorPresentation = {
  kind: RequestErrorKind;
  title: string;
  message: string;
};

export function getRequestErrorPresentation(
  error: unknown,
  fallbackMessage: string,
): RequestErrorPresentation {
  const code = error instanceof ApiError ? error.code : null;

  switch (code) {
    case "NETWORK_ERROR":
      return {
        kind: "offline",
        title: "Đang ngoại tuyến",
        message: "Không thể kết nối đến máy chủ. Kiểm tra mạng rồi thử lại.",
      };
    case "TIMEOUT":
      return {
        kind: "timeout",
        title: "Máy chủ phản hồi chậm",
        message: "Yêu cầu chưa có kết quả. Bạn có thể thử lại an toàn.",
      };
    case "REQUEST_ABORTED":
      return {
        kind: "cancelled",
        title: "Yêu cầu đã dừng",
        message: "Yêu cầu đã được hủy. Bạn có thể thực hiện lại khi sẵn sàng.",
      };
    default:
      return {
        kind: "generic",
        title: "Không thể tải dữ liệu",
        message: error instanceof ApiError ? error.message : fallbackMessage,
      };
  }
}
