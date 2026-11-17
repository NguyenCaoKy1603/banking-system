import type {
  AuthChallengeResponse,
  MfaCredentialSummary,
  TotpEnrollmentResponse,
} from "@/features/auth/types/auth";
import type { AuthSession } from "@/features/auth/types/session";

export type PendingMfaLifecycleAction =
  | { kind: "remove"; credential: MfaCredentialSummary }
  | { kind: "rotate" }
  | { kind: "enroll" };

type CachedEnrollment = {
  userId: string;
  sessionEpoch: string;
  enrollment: TotpEnrollmentResponse;
};

type CachedLifecycleChallenge = {
  userId: string;
  sessionEpoch: string;
  action: PendingMfaLifecycleAction;
  challenge: AuthChallengeResponse;
};

type SessionScope = Pick<AuthSession, "sessionEpoch" | "user">;

let pendingEnrollment: CachedEnrollment | null = null;
let pendingLifecycleChallenge: CachedLifecycleChallenge | null = null;

function isNotExpired(expiresAt: string, now = Date.now()): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now;
}

/**
 * Keeps an in-progress TOTP enrollment in volatile RAM only (never persisted to
 * disk) so returning to `/mfa` after a long background refresh within the same
 * authenticated session epoch does not discard the setup key mid-enrollment.
 */
export function savePendingTotpEnrollment(
  session: SessionScope | null | undefined,
  enrollment: TotpEnrollmentResponse,
): void {
  if (!session || !isNotExpired(enrollment.expiresAt)) {
    pendingEnrollment = null;
    return;
  }

  pendingEnrollment = {
    userId: session.user.id,
    sessionEpoch: session.sessionEpoch,
    enrollment,
  };
}

/**
 * Loads the cached in-progress TOTP enrollment if it belongs to the active
 * user/session epoch and has not expired.
 */
export function loadPendingTotpEnrollment(
  session: SessionScope | null | undefined,
  now = Date.now(),
): TotpEnrollmentResponse | null {
  if (!session || !pendingEnrollment) {
    return null;
  }

  if (
    pendingEnrollment.userId !== session.user.id ||
    pendingEnrollment.sessionEpoch !== session.sessionEpoch ||
    !isNotExpired(pendingEnrollment.enrollment.expiresAt, now)
  ) {
    pendingEnrollment = null;
    return null;
  }

  return pendingEnrollment.enrollment;
}

/**
 * Keeps an in-progress MFA lifecycle challenge (such as TOTP or Email OTP step-up
 * for factor change/removal/recovery rotation) in volatile RAM scoped by sessionEpoch.
 */
export function savePendingMfaChallenge(
  session: SessionScope | null | undefined,
  action: PendingMfaLifecycleAction,
  challenge: AuthChallengeResponse,
): void {
  if (!session || !isNotExpired(challenge.expiresAt)) {
    pendingLifecycleChallenge = null;
    return;
  }

  pendingLifecycleChallenge = {
    userId: session.user.id,
    sessionEpoch: session.sessionEpoch,
    action,
    challenge,
  };
}

/**
 * Loads the cached MFA lifecycle challenge if it belongs to the active
 * user/session epoch and has not expired.
 */
export function loadPendingMfaChallenge(
  session: SessionScope | null | undefined,
  now = Date.now(),
): { action: PendingMfaLifecycleAction; challenge: AuthChallengeResponse } | null {
  if (!session || !pendingLifecycleChallenge) {
    return null;
  }

  if (
    pendingLifecycleChallenge.userId !== session.user.id ||
    pendingLifecycleChallenge.sessionEpoch !== session.sessionEpoch ||
    !isNotExpired(pendingLifecycleChallenge.challenge.expiresAt, now)
  ) {
    pendingLifecycleChallenge = null;
    return null;
  }

  return {
    action: pendingLifecycleChallenge.action,
    challenge: pendingLifecycleChallenge.challenge,
  };
}

export function clearPendingMfaChallenge(): void {
  pendingLifecycleChallenge = null;
}

/** Clears all volatile MFA enrollment and challenge drafts from memory immediately. */
export function clearPendingTotpEnrollment(): void {
  pendingEnrollment = null;
  pendingLifecycleChallenge = null;
}
