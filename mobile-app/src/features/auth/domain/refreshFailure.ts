import { ApiError } from "@/services/api/ApiError";

export function isTerminalRefreshFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
