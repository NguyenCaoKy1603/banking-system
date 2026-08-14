import { ApiError } from "@/services/api/ApiError";
import { apiConfig } from "@/services/api/config";
import type { ApiErrorPayload } from "@/services/api/types";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
};

type ResponseValidator<ResponseBody> = (
  payload: unknown,
) => payload is ResponseBody;

function buildUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");

  return `${normalizedBaseUrl}/${normalizedPath}`;
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

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw createInvalidResponseError(response.status);
  }
}

export async function requestJson<ResponseBody>(
  path: string,
  options: RequestOptions = {},
  validateResponse?: ResponseValidator<ResponseBody>,
): Promise<ResponseBody> {
  const { body, method = "GET" } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;

  try {
    response = await fetch(buildUrl(apiConfig.baseUrl, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError({
      status: null,
      code: "NETWORK_ERROR",
      message: "Không thể kết nối đến máy chủ.",
    });
  }

  const payload = await parseJson(response);

  if (!response.ok) {
    if (!isApiErrorPayload(payload)) {
      throw createInvalidResponseError(response.status);
    }

    throw new ApiError({
      status: response.status,
      code: payload.code,
      message: payload.message,
      fieldErrors: payload.fieldErrors,
      traceId: payload.traceId,
    });
  }

  if (validateResponse && !validateResponse(payload)) {
    throw createInvalidResponseError(response.status);
  }

  return payload as ResponseBody;
}
