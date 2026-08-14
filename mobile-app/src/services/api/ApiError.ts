import type { ApiErrorPayload } from "@/services/api/types";

type ApiErrorOptions = {
  status: number | null;
  code: string;
  message: string;
  fieldErrors?: ApiErrorPayload["fieldErrors"];
  traceId?: string | null;
};

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly fieldErrors: ApiErrorPayload["fieldErrors"];
  readonly traceId: string | null;

  constructor({
    status,
    code,
    message,
    fieldErrors = null,
    traceId = null,
  }: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.traceId = traceId;
  }
}
