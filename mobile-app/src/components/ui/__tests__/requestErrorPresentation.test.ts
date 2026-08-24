import { ApiError } from "@/services/api/ApiError";
import { getRequestErrorPresentation } from "@/components/ui/requestErrorPresentation";

describe("request error presentation", () => {
  it("shows an offline retry state for network failures", () => {
    expect(
      getRequestErrorPresentation(
        new ApiError({
          status: null,
          code: "NETWORK_ERROR",
          message: "network failure",
        }),
        "fallback",
      ),
    ).toEqual({
      kind: "offline",
      title: "Đang ngoại tuyến",
      message: "Không thể kết nối đến máy chủ. Kiểm tra mạng rồi thử lại.",
    });
  });

  it("explains that a timeout can be retried safely", () => {
    expect(
      getRequestErrorPresentation(
        new ApiError({ status: null, code: "TIMEOUT", message: "timeout" }),
        "fallback",
      ),
    ).toMatchObject({
      kind: "timeout",
      title: "Máy chủ phản hồi chậm",
    });
  });

  it("preserves a server message for other API errors", () => {
    expect(
      getRequestErrorPresentation(
        new ApiError({ status: 422, code: "VALIDATION_ERROR", message: "Số tiền không hợp lệ." }),
        "fallback",
      ),
    ).toEqual({
      kind: "generic",
      title: "Không thể tải dữ liệu",
      message: "Số tiền không hợp lệ.",
    });
  });
});
