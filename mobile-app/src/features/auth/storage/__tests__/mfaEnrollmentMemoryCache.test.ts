import {
  clearPendingMfaChallenge,
  clearPendingTotpEnrollment,
  loadPendingMfaChallenge,
  loadPendingTotpEnrollment,
  savePendingMfaChallenge,
  savePendingTotpEnrollment,
} from "@/features/auth/storage/mfaEnrollmentMemoryCache";
import type {
  AuthChallengeResponse,
  MfaCredentialSummary,
  TotpEnrollmentResponse,
} from "@/features/auth/types/auth";

describe("mfaEnrollmentMemoryCache", () => {
  const makeSession = (id: string, sessionEpoch: string) => ({
    sessionEpoch,
    user: {
      id,
      fullName: `User ${id}`,
      email: `${id}@example.test`,
      phoneNumber: "0900000001",
      createdAt: "2026-11-16T00:00:00.000Z",
    },
  });

  const sessionA = makeSession("user-1", "epoch-1");
  const sessionOtherUser = makeSession("user-2", "epoch-1");
  const sessionNewEpoch = makeSession("user-1", "epoch-2");

  const futureTime = new Date(Date.now() + 60_000).toISOString();
  const pastTime = new Date(Date.now() - 60_000).toISOString();

  const enrollment: TotpEnrollmentResponse = {
    credentialId: "cred-1",
    status: "PENDING",
    expiresAt: futureTime,
    manualSetupKey: "TEST-SETUP-KEY",
    otpauthUri: "otpauth://totp/NOVA:test?secret=ABC",
  };

  const challenge: AuthChallengeResponse = {
    challengeId: "chg-1",
    expiresAt: futureTime,
    methods: ["TOTP"],
    purpose: "MFA_FACTOR_CHANGE",
  };

  const credentialSummary: MfaCredentialSummary = {
    id: "cred-1",
    customerId: "user-1",
    credentialType: "TOTP",
    displayName: "Authenticator",
    status: "ACTIVE",
    algorithm: "SHA1",
    digits: 6,
    periodSeconds: 30,
    lastAcceptedTimeStep: null,
    enrolledAt: "2026-11-16T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    compromisedAt: null,
    createdAt: "2026-11-16T00:00:00.000Z",
  };

  beforeEach(() => {
    clearPendingTotpEnrollment();
  });

  it("saves and loads pending TOTP enrollment for matching active session", () => {
    savePendingTotpEnrollment(sessionA, enrollment);
    expect(loadPendingTotpEnrollment(sessionA)).toEqual(enrollment);
  });

  it("clears and refuses saving TOTP enrollment when session is missing or expired", () => {
    savePendingTotpEnrollment(sessionA, enrollment);
    savePendingTotpEnrollment(null, enrollment);
    expect(loadPendingTotpEnrollment(sessionA)).toBeNull();

    savePendingTotpEnrollment(sessionA, { ...enrollment, expiresAt: pastTime });
    expect(loadPendingTotpEnrollment(sessionA)).toBeNull();

    savePendingTotpEnrollment(sessionA, { ...enrollment, expiresAt: "invalid-date" });
    expect(loadPendingTotpEnrollment(sessionA)).toBeNull();
  });

  it("returns null and clears enrollment on user mismatch, epoch change, or expiry", () => {
    expect(loadPendingTotpEnrollment(sessionA)).toBeNull();

    savePendingTotpEnrollment(sessionA, enrollment);
    expect(loadPendingTotpEnrollment(sessionOtherUser)).toBeNull();
    expect(loadPendingTotpEnrollment(sessionA)).toBeNull();

    savePendingTotpEnrollment(sessionA, enrollment);
    expect(loadPendingTotpEnrollment(sessionNewEpoch)).toBeNull();

    savePendingTotpEnrollment(sessionA, enrollment);
    expect(
      loadPendingTotpEnrollment(sessionA, Date.parse(futureTime) + 1_000),
    ).toBeNull();
  });

  it("saves, loads, and clears MFA lifecycle challenge within session scope", () => {
    expect(loadPendingMfaChallenge(sessionA)).toBeNull();

    savePendingMfaChallenge(null, { kind: "rotate" }, challenge);
    expect(loadPendingMfaChallenge(sessionA)).toBeNull();

    savePendingMfaChallenge(sessionA, { kind: "rotate" }, { ...challenge, expiresAt: pastTime });
    expect(loadPendingMfaChallenge(sessionA)).toBeNull();

    savePendingMfaChallenge(
      sessionA,
      { kind: "remove", credential: credentialSummary },
      challenge,
    );
    expect(loadPendingMfaChallenge(sessionA)).toEqual({
      action: { kind: "remove", credential: credentialSummary },
      challenge,
    });

    expect(loadPendingMfaChallenge(sessionOtherUser)).toBeNull();
    expect(loadPendingMfaChallenge(sessionA)).toBeNull();

    savePendingMfaChallenge(sessionA, { kind: "rotate" }, challenge);
    expect(loadPendingMfaChallenge(sessionNewEpoch)).toBeNull();

    savePendingMfaChallenge(sessionA, { kind: "rotate" }, challenge);
    expect(
      loadPendingMfaChallenge(sessionA, Date.parse(futureTime) + 1_000),
    ).toBeNull();

    savePendingMfaChallenge(sessionA, { kind: "enroll" }, challenge);
    clearPendingMfaChallenge();
    expect(loadPendingMfaChallenge(sessionA)).toBeNull();
  });
});
