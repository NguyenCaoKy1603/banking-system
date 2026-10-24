import { ApiError } from "@/services/api/ApiError";
import { apiConfig } from "@/services/api/config";
import type { ApiErrorPayload } from "@/services/api/types";
import { recordTelemetryEvent } from "@/services/telemetry/safeTelemetry";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestAuth = {
  accessToken?: string | null;
  deviceId?: string | null;
  refreshAccessToken?: () => Promise<string | null>;
};

export type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  auth?: RequestAuth;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  requestId?: string;
  idempotencyKey?: string;
  retryOnUnauthorized?: boolean;
};

type ResponseValidator<ResponseBody> = (
  payload: unknown,
) => payload is ResponseBody;

const DEFAULT_TIMEOUT_MS = 15_000;
const SAFE_SERVER_ERROR_MESSAGE =
  "Dịch vụ đang tạm thời gián đoạn. Vui lòng thử lại sau.";
let requestSequence = 0;
const refreshPromises = new WeakMap<
  () => Promise<string | null>,
  Promise<string | null>
>();

function buildUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  return `${normalizedBaseUrl}/${normalizedPath}`;
}

function createRequestId(): string {
  requestSequence += 1;
  return `mobile-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldErrors(value: unknown): value is Record<string, string> | null {
  if (value === null) {
    return true;
  }

  return (
    isRecord(value) && Object.values(value).every((message) => typeof message === "string")
  );
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    isFieldErrors(value.fieldErrors) &&
    typeof value.traceId === "string"
  );
}

function createInvalidResponseError(status: number) {
  return new ApiError({
    status,
    code: "INVALID_RESPONSE",
    message: "Phản hồi từ máy chủ không đúng định dạng mong đợi.",
  });
}

function createTimeoutError() {
  return new ApiError({
    status: null,
    code: "TIMEOUT",
    message: "Yêu cầu đến máy chủ đã hết thời gian chờ.",
  });
}

function createAbortedError() {
  return new ApiError({
    status: null,
    code: "REQUEST_ABORTED",
    message: "Yêu cầu đã được hủy.",
  });
}

function reportApiFailure(method: HttpMethod, error: ApiError): void {
  recordTelemetryEvent("api_request_failed", {
    method,
    status: error.status,
    code: error.code,
    traceId: error.traceId,
  });
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw createInvalidResponseError(response.status);
  }
}

function createAbortState(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let didTimeout = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else if (signal) {
    signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  if (!controller.signal.aborted) {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    controller,
    didTimeout: () => didTimeout,
    cleanup: () => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

async function refreshAccessTokenSingleFlight(
  refreshAccessToken: () => Promise<string | null>,
): Promise<string | null> {
  const existingPromise = refreshPromises.get(refreshAccessToken);
  if (existingPromise) {
    return existingPromise;
  }

  const refreshPromise = Promise.resolve()
      .then(refreshAccessToken)
      .then((token) => (typeof token === "string" && token.trim() ? token : null))
      .finally(() => {
        if (refreshPromises.get(refreshAccessToken) === refreshPromise) {
          refreshPromises.delete(refreshAccessToken);
        }
      });
  refreshPromises.set(refreshAccessToken, refreshPromise);

  return refreshPromise;
}

function validateRequestOptions(options: RequestOptions): void {
  if (options.timeoutMs !== undefined) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new RangeError("timeoutMs phải là số hữu hạn lớn hơn 0.");
    }
  }
}

export async function requestJson<ResponseBody>(
  path: string,
  options: RequestOptions = {},
  validateResponse?: ResponseValidator<ResponseBody>,
): Promise<ResponseBody> {
  validateRequestOptions(options);

  const {
    auth,
    body,
    headers: customHeaders,
    idempotencyKey,
    method = "GET",
    requestId = createRequestId(),
    retryOnUnauthorized = true,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...customHeaders,
    "X-Request-ID": requestId,
  };
  const accessToken = auth?.accessToken?.trim();
  const deviceId = auth?.deviceId?.trim();

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (deviceId) {
    headers["X-Device-ID"] = deviceId;
  }

  if (body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (idempotencyKey?.trim()) {
    headers["Idempotency-Key"] = idempotencyKey.trim();
  }

  const abortState = createAbortState(signal, timeoutMs);
  let response: Response;

  try {
    response = await fetch(buildUrl(apiConfig.baseUrl, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abortState.controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      reportApiFailure(method, error);
      throw error;
    }

    if (abortState.didTimeout()) {
      const timeoutError = createTimeoutError();
      reportApiFailure(method, timeoutError);
      throw timeoutError;
    }

    if (abortState.controller.signal.aborted) {
      const abortedError = createAbortedError();
      reportApiFailure(method, abortedError);
      throw abortedError;
    }

    const networkError = new ApiError({
      status: null,
      code: "NETWORK_ERROR",
      message: "Không thể kết nối đến máy chủ.",
    });
    reportApiFailure(method, networkError);
    throw networkError;
  } finally {
    abortState.cleanup();
  }

  if (
    response.status === 401 &&
    retryOnUnauthorized &&
    auth?.refreshAccessToken
  ) {
    const refreshedAccessToken = await refreshAccessTokenSingleFlight(
      auth.refreshAccessToken,
    );

    if (refreshedAccessToken) {
      return requestJson<ResponseBody>(
        path,
        {
          ...options,
          auth: {
            ...auth,
            accessToken: refreshedAccessToken,
          },
          requestId,
          retryOnUnauthorized: false,
        },
        validateResponse,
      );
    }
  }

  let payload: unknown;

  try {
    payload = response.status === 204 ? null : await parseJson(response);
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      reportApiFailure(method, error);
    }
    throw error;
  }

  if (!response.ok) {
    if (!isApiErrorPayload(payload)) {
      const invalidResponseError = createInvalidResponseError(response.status);
      reportApiFailure(method, invalidResponseError);
      throw invalidResponseError;
    }

    const apiError = new ApiError({
      status: response.status,
      code: payload.code,
      message: response.status >= 500 ? SAFE_SERVER_ERROR_MESSAGE : payload.message,
      fieldErrors: payload.fieldErrors,
      traceId: payload.traceId,
    });
    reportApiFailure(method, apiError);
    throw apiError;
  }

  if (validateResponse && !validateResponse(payload)) {
    const invalidResponseError = createInvalidResponseError(response.status);
    reportApiFailure(method, invalidResponseError);
    throw invalidResponseError;
  }

  return payload as ResponseBody;
}
