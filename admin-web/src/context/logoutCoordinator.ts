export interface PendingLogout {
  promise: Promise<void>;
  abortController: AbortController;
}

export const LOGOUT_DRAIN_TIMEOUT_MS = 3000;

/**
 * Coordinates logout and login transitions.
 * Ensures that if a previous logout request is in-flight, the app awaits its completion
 * (so its Set-Cookie: Max-Age=0 headers are processed by the browser) before a new login
 * sets new session cookies.
 *
 * If the logout request is hanging (e.g. server delay or network stall), it aborts the
 * in-flight request after timeoutMs to allow login to proceed safely.
 * When the logout finishes early, the timer is cleared immediately to prevent leaked aborts.
 */
export async function drainPendingLogout(
  pending: PendingLogout | null,
  timeoutMs: number = LOGOUT_DRAIN_TIMEOUT_MS
): Promise<void> {
  if (!pending) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      try {
        pending.abortController.abort();
      } catch {}
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([pending.promise, timeoutPromise]);
  } catch {}

  if (timer !== undefined) {
    clearTimeout(timer);
  }
}
