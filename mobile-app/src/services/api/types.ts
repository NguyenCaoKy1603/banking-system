export type ApiErrorPayload = {
  code: string;
  message: string;
  fieldErrors: Record<string, string> | null;
  traceId: string;
};
