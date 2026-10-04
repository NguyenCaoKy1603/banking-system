export type ApiError = Error & {
  code?: string;
  status?: number;
  traceId?: string;
  fieldErrors?: Record<string, string>;
  isNetworkOrTimeout?: boolean;
};

// The browser always talks to the same origin. Development Vite and the
// production Nginx container proxy `/api` to the configured Admin API
// upstream, so no environment-specific URL is embedded in this bundle.
const API_BASE = "/api/v1";
let csrfTokenValue = "";

export function setCsrfToken(value: unknown): void {
  if (typeof value === "string" && value.length > 0) {
    csrfTokenValue = value;
  }
}

function csrfToken(): string {
  if (csrfTokenValue) return csrfTokenValue;
  const token = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("admin_csrf="));
  return token ? decodeURIComponent(token.slice("admin_csrf=".length)) : "";
}

export type AdminFetchOptions = RequestInit & {
  timeoutMs?: number;
};

export function isIndeterminateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as ApiError;
  return (
    Boolean(err.isNetworkOrTimeout) ||
    err.status === 0 ||
    err.code === "TIMEOUT" ||
    err.code === "NETWORK_ERROR" ||
    err.code === "INVALID_RESPONSE" ||
    err.code === "GATEWAY_ERROR" ||
    err.name === "AbortError" ||
    err.name === "TimeoutError" ||
    (typeof err.status === "number" && err.status >= 502 && err.status <= 504)
  );
}

export async function adminFetch<T>(path: string, init: AdminFetchOptions = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken());
  }

  const defaultTimeoutMs =
    (typeof window !== "undefined" &&
      (window as unknown as { __ADMIN_TIMEOUT_MS__?: number }).__ADMIN_TIMEOUT_MS__) ||
    15_000;
  const timeoutMs =
    typeof init.timeoutMs === "number" && init.timeoutMs > 0 ? init.timeoutMs : defaultTimeoutMs;
  const timeoutController = new AbortController();
  let isTimedOut = false;
  const timeoutId = setTimeout(() => {
    isTimedOut = true;
    timeoutController.abort(new Error("REQUEST_TIMEOUT"));
  }, timeoutMs);

  let effectiveSignal: AbortSignal = timeoutController.signal;
  let removeCallerListener: (() => void) | null = null;

  if (init.signal) {
    if (init.signal.aborted) {
      clearTimeout(timeoutId);
      throw init.signal.reason || new Error("Aborted");
    }
    if (typeof AbortSignal.any === "function") {
      effectiveSignal = AbortSignal.any([init.signal, timeoutController.signal]);
    } else {
      const callerSignal = init.signal;
      const onCallerAbort = () => {
        timeoutController.abort(callerSignal.reason);
      };
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      removeCallerListener = () => {
        callerSignal.removeEventListener("abort", onCallerAbort);
      };
    }
  }

  let response: Response;
  let rawText = "";
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: effectiveSignal,
    });
    // The active deadline covers both the network socket connection and response body transmission
    rawText = await response.text();
  } catch (networkCaught) {
    clearTimeout(timeoutId);
    if (removeCallerListener) removeCallerListener();

    // Differentiate between user-initiated client cancellation (e.g. navigation / switching customer)
    // and network or deadline timeouts
    if (init.signal?.aborted && !isTimedOut) {
      const callerAbortErr = new Error("Yêu cầu đã bị hủy do đổi đối tượng.") as ApiError;
      callerAbortErr.name = "AbortError";
      callerAbortErr.code = "CLIENT_ABORT";
      callerAbortErr.status = 0;
      throw callerAbortErr;
    }

    const isAbortOrTimeout =
      isTimedOut || (networkCaught instanceof Error && networkCaught.name === "AbortError");
    const netError = new Error(
      isAbortOrTimeout
        ? "Yêu cầu đã quá thời gian chờ (Timeout). Kết quả chưa xác định."
        : "Không thể kết nối đến máy chủ. Kết quả chưa xác định."
    ) as ApiError;
    netError.name = isAbortOrTimeout ? "TimeoutError" : "NetworkError";
    netError.code = isAbortOrTimeout ? "TIMEOUT" : "NETWORK_ERROR";
    netError.status = 0;
    netError.isNetworkOrTimeout = true;
    throw netError;
  } finally {
    clearTimeout(timeoutId);
    if (removeCallerListener) removeCallerListener();
  }

  let payload: unknown = null;
  if (rawText.trim().length > 0) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      // If server returned a success status (200/201/202) on a mutating command (POST/PUT/PATCH/DELETE),
      // but the response body is corrupted / not valid JSON, we MUST NOT swallow the error!
      // The server may have committed the mutation, so the result is INDETERMINATE and requires reconciliation.
      if (response.ok && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        const invalidJsonErr = new Error(
          "Máy chủ trả về phản hồi không hợp lệ (không thể đọc JSON). Kết quả chưa xác định."
        ) as ApiError;
        invalidJsonErr.code = "INVALID_RESPONSE";
        invalidJsonErr.status = response.status;
        invalidJsonErr.isNetworkOrTimeout = true;
        throw invalidJsonErr;
      }
    }
  } else {
    // Empty body is valid for 204 No Content, but NOT for mutating endpoints requiring an action ID
    if (response.ok && response.status !== 204 && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      const emptyBodyErr = new Error(
        "Máy chủ trả về dữ liệu rỗng cho thao tác ghi. Kết quả chưa xác định."
      ) as ApiError;
      emptyBodyErr.code = "INVALID_RESPONSE";
      emptyBodyErr.status = response.status;
      emptyBodyErr.isNetworkOrTimeout = true;
      throw emptyBodyErr;
    }
  }

  if (!response.ok) {
    const data = payload as {
      code?: string;
      message?: string;
      traceId?: string;
      fieldErrors?: Record<string, string>;
    } | null;

    const error = new Error(data?.message ?? `Yêu cầu thất bại (${response.status})`) as ApiError;
    error.code =
      data?.code ?? (response.status >= 502 && response.status <= 504 ? "GATEWAY_ERROR" : undefined);
    error.status = response.status;
    error.traceId = data?.traceId ?? response.headers.get("X-Request-ID") ?? undefined;
    error.fieldErrors = data?.fieldErrors;
    // Gateway errors on mutating endpoints may indicate upstream processing state is unknown
    if (response.status >= 502 && response.status <= 504 && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      error.isNetworkOrTimeout = true;
    }
    throw error;
  }

  if (payload && typeof payload === "object" && "csrfToken" in payload) {
    setCsrfToken((payload as { csrfToken?: unknown }).csrfToken);
  }

  return payload as T;
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function formatMinor(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "0 VND";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return `${value} VND`;
  return `${num.toLocaleString("vi-VN")} VND`;
}

export function shortId(value: string | null | undefined, length = 8): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function formatDate(value: string | undefined | null): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString("vi-VN");
  } catch {
    return value;
  }
}

export function getErrorMessage(error: ApiError | null, context?: "activation" | "auth"): string {
  if (!error) return "";
  if (context === "activation" && error.status === 401) {
    return "Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.";
  }
  if (error.status === 401) {
    return "Phiên làm việc đã hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại.";
  }
  if (error.status === 403 || error.code === "ADMIN_PERMISSION_DENIED") {
    return "Bạn không có quyền thực hiện thao tác này theo chính sách phân quyền.";
  }
  if (error.code === "ACTION_STALE") {
    return "Dữ liệu đối tượng đã thay đổi kể từ lúc tạo yêu cầu; vui lòng tải lại trước khi quyết định.";
  }
  if (error.code === "ACTION_ALREADY_DECIDED") {
    return "Yêu cầu này đã được quyết định hoặc hủy bởi một nhân viên khác.";
  }
  if (error.code === "ACTION_FINGERPRINT_MISMATCH") {
    return "Nội dung yêu cầu không khớp với chữ ký số (fingerprint); vui lòng tải lại trang.";
  }
  if (error.code === "STAFF_MFA_REQUIRED") {
    return "Yêu cầu bước xác thực MFA TOTP bổ sung (Step-up).";
  }
  if (error.code === "ACCOUNT_STATUS_CONFLICT") {
    return "Trạng thái tài khoản/khách hàng hiện tại xung đột với yêu cầu.";
  }
  if (error.code === "FUNDING_LIMIT_EXCEEDED") {
    return "Số tiền cấp vượt quá hạn mức tối đa cho phép trong phiên thử nghiệm.";
  }
  if (error.code === "CSRF_INVALID") {
    return "CSRF token không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang.";
  }
  if (error.code === "IDEMPOTENCY_CONFLICT") {
    return "Khóa trùng lặp (Idempotency Key) đã được sử dụng cho một yêu cầu khác.";
  }
  return error.message || "Đã xảy ra lỗi khi xử lý yêu cầu.";
}
