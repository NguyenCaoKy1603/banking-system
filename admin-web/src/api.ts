export type ApiError = Error & { code?: string; status?: number; traceId?: string };
const API_BASE = (import.meta.env.VITE_ADMIN_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://127.0.0.1:5001/api/v1";
let csrfTokenValue = "";

export function setCsrfToken(value: unknown): void { if (typeof value === "string" && value.length > 0) csrfTokenValue = value; }

function csrfToken(): string {
  if (csrfTokenValue) return csrfTokenValue;
  const token = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("admin_csrf="));
  return token ? decodeURIComponent(token.slice("admin_csrf=".length)) : "";
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRF-Token", csrfToken());
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* empty 204 */ }
  if (!response.ok) {
    const data = payload as { code?: string; message?: string; traceId?: string } | null;
    const error = new Error(data?.message ?? `Request failed (${response.status})`) as ApiError;
    error.code = data?.code; error.status = response.status; error.traceId = data?.traceId ?? response.headers.get("X-Request-ID") ?? undefined;
    throw error;
  }
  if (payload && typeof payload === "object" && "csrfToken" in payload) setCsrfToken((payload as { csrfToken?: unknown }).csrfToken);
  return payload as T;
}

export function idempotencyKey(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
