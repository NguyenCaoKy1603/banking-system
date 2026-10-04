import { createHash, randomUUID } from "node:crypto";

import { conflictWithCode, invalidRequest, rateLimited, unauthorized } from "../../errors.js";
import { createOpaqueToken, hashOpaqueToken, hashPasswordAsync, verifyPasswordAsync } from "../../security.js";
import { buildTotpUri, generateTotpSecret, type KeyEncryptionPort, validateTotp } from "../../mfa/crypto.js";
import type { AdminRole, AdminSubject } from "../authorization/permissionRegistry.js";
import type { AdminRepository, StaffRecord, StaffSessionRecord } from "../repositories/adminRepository.js";

const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;

export type AdminTokenSet = {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresInSeconds: number;
};

export type BeginStaffLoginResult =
  | { mfaRequired: true; challengeId: string; expiresAt: string }
  | { mfaRequired: false; staff: StaffRecord; tokens: AdminTokenSet };

export type StaffAuthServiceOptions = {
  repository: AdminRepository;
  encryption: KeyEncryptionPort;
  clock?: () => number;
  environmentScope?: string;
};

function nowIso(clock: () => number): string { return new Date(clock()).toISOString(); }
function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function hasActiveRole(staff: StaffRecord, role: AdminRole, environmentScope: string, now: number): boolean {
  return staff.roles.some((assignment) => assignment.role === role && assignment.environmentScope === environmentScope && (!assignment.expiresAt || Date.parse(assignment.expiresAt) > now));
}
function assertPassword(password: unknown): string { if (typeof password !== "string" || password.length < 12 || password.length > 256) throw invalidRequest("Staff password must contain 12-256 characters.", { password: "Use at least 12 characters." }); return password; }
function assertCode(code: unknown): string { if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw invalidRequest("MFA code must contain six digits.", { code: "Enter a six-digit authenticator code." }); return code; }
function envelopeMetadata(ciphertext: string): { version: string; aadVersion: string | null; algorithm: string; encryptedDataKey: string | null } { const parts = ciphertext.split("."); return { version: parts[0] === "v2" ? "v2" : "v1", aadVersion: parts[0] === "v2" ? parts[2] ?? null : null, algorithm: parts[0] === "v2" ? "AES-256-GCM-ENVELOPE" : "AES-256-GCM", encryptedDataKey: parts[0] === "v2" ? parts[6] ?? null : null }; }

export class StaffAuthService {
  private readonly clock: () => number;
  private readonly environmentScope: string;
  private readonly loginFailures = new Map<string, { startedAt: number; attempts: number }>();

  constructor(private readonly options: StaffAuthServiceOptions) {
    this.clock = options.clock ?? (() => Date.now());
    this.environmentScope = options.environmentScope ?? "preview";
  }

  async invite(input: { email: string; employeeCode: string; displayName: string; role: AdminRole; createdByStaffId?: string | null }): Promise<{ inviteId: string; token: string; expiresAt: string }> {
    const email = normalizeEmail(input.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw invalidRequest("Staff email is invalid.", { email: "Enter a valid email." });
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(input.employeeCode.trim())) throw invalidRequest("Employee code is invalid.", { employeeCode: "Use letters, digits, dot, underscore or hyphen." });
    const token = createOpaqueToken();
    const inviteId = randomUUID();
    const expiresAt = new Date(this.clock() + 24 * 60 * 60 * 1000).toISOString();
    await this.options.repository.createStaffInvite({ id: inviteId, emailNormalized: email, employeeCode: input.employeeCode.trim(), displayName: input.displayName.trim(), roleCode: input.role, tokenHash: hashOpaqueToken(token), expiresAt, createdByStaffId: input.createdByStaffId ?? null });
    return { inviteId, token, expiresAt };
  }

  async activate(input: { inviteToken: string; password: string; totpSecret?: string }): Promise<{ staffId: string; mfaSetup?: { secret: string; otpauthUri: string } }> {
    if (typeof input.inviteToken !== "string" || input.inviteToken.length < 32) throw unauthorized("Staff invitation is invalid or expired.");
    const invite = await this.options.repository.findInviteByHash(hashOpaqueToken(input.inviteToken));
    if (!invite) throw unauthorized("Staff invitation is invalid or expired.");
    const password = assertPassword(input.password);
    const hashed = await hashPasswordAsync(password);
    const staff = await this.options.repository.activateInvite({ inviteId: invite.id, passwordSalt: hashed.salt, passwordDigest: hashed.digest, staffId: invite.id });
    const secret = input.totpSecret?.trim() || generateTotpSecret();
    const credentialId = randomUUID();
    const secretCiphertext = this.options.encryption.encrypt(secret, this.encryptionContext(credentialId, staff.id));
    const metadata = envelopeMetadata(secretCiphertext);
    await this.options.repository.createMfaCredential({ id: credentialId, staffId: staff.id, secretCiphertext, encryptionKeyId: this.options.encryption.keyId, secretCipherVersion: metadata.version, secretAadVersion: metadata.aadVersion, secretEncryptionAlgorithm: metadata.algorithm, secretEncryptedDataKey: metadata.encryptedDataKey, lastAcceptedTimeStep: null });
    await this.options.repository.appendAudit({ id: randomUUID(), actorStaffId: staff.id, action: "STAFF_INVITE_ACTIVATED", targetType: "STAFF", targetId: staff.id, outcome: "SUCCEEDED", reasonCode: "INVITE_ACTIVATED", requestId: null, traceId: null, correlationId: null, beforeVersion: null, afterVersion: staff.authorizationVersion, metadata: { role: staff.roles[0]?.role ?? "UNKNOWN", environment: this.environmentScope } });
    return input.totpSecret ? { staffId: staff.id } : { staffId: staff.id, mfaSetup: { secret, otpauthUri: buildTotpUri(secret, staff.emailNormalized) } };
  }

  beginOperationsMfaSetup(emailInput: string): { mfaSetup: { manualSetupKey: string; otpauthUri: string } } {
    const email = normalizeEmail(emailInput);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw invalidRequest("Staff email is invalid.", { email: "Enter a valid email." });
    const secret = generateTotpSecret();
    return { mfaSetup: { manualSetupKey: secret, otpauthUri: buildTotpUri(secret, email) } };
  }

  async createOperationsAccount(input: {
    email: string;
    employeeCode: string;
    displayName: string;
    password: string;
    mfaSecret: string;
    mfaCode: string;
    creatorStaffId: string;
    environmentScope: "preview" | "production";
    idempotencyKey: string;
    traceId: string;
  }): Promise<{ staff: StaffRecord; replayed: boolean }> {
    const email = normalizeEmail(input.email);
    const employeeCode = input.employeeCode.trim();
    const displayName = input.displayName.trim();
    const password = assertPassword(input.password);
    const secret = input.mfaSecret.trim().toUpperCase();
    const code = assertCode(input.mfaCode);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw invalidRequest("Staff email is invalid.", { email: "Enter a valid email." });
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(employeeCode)) throw invalidRequest("Employee code is invalid.", { employeeCode: "Use 2-64 letters, digits, dot, underscore or hyphen." });
    if (displayName.length < 2 || displayName.length > 120) throw invalidRequest("Staff display name is invalid.", { displayName: "Use 2-120 characters." });
    if (!/^[A-Z2-7]{32}$/.test(secret)) throw invalidRequest("Authenticator setup key is invalid.", { mfaSecret: "Generate a new MFA setup key." });

    const validation = validateTotp(secret, code, this.clock(), 1);
    if (!validation.valid || validation.timeStep === null) throw invalidRequest("Authenticator code is invalid.", { mfaCode: "Enter the current six-digit Authenticator code." });

    const hashed = await hashPasswordAsync(password);
    const staffId = randomUUID();
    const credentialId = randomUUID();
    const secretCiphertext = this.options.encryption.encrypt(secret, this.encryptionContext(credentialId, staffId));
    const metadata = envelopeMetadata(secretCiphertext);
    const fingerprint = createHash("sha256").update(JSON.stringify({ email, employeeCode, displayName, role: "OPERATIONS", environmentScope: input.environmentScope })).digest("hex");
    try {
      return await this.options.repository.createOperationsStaffAccount({
        staffId,
        employeeCode,
        emailNormalized: email,
        displayName,
        passwordSalt: hashed.salt,
        passwordDigest: hashed.digest,
        creatorStaffId: input.creatorStaffId,
        environmentScope: input.environmentScope,
        mfaCredential: {
          id: credentialId,
          staffId,
          secretCiphertext,
          encryptionKeyId: this.options.encryption.keyId,
          secretCipherVersion: metadata.version,
          secretAadVersion: metadata.aadVersion,
          secretEncryptionAlgorithm: metadata.algorithm,
          secretEncryptedDataKey: metadata.encryptedDataKey,
          lastAcceptedTimeStep: validation.timeStep,
        },
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        traceId: input.traceId,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "STAFF_ACCOUNT_IDEMPOTENCY_CONFLICT") {
        throw conflictWithCode("IDEMPOTENCY_CONFLICT", "This Admin request key was already used with different account details.");
      }
      if (error instanceof Error && error.message === "STAFF_ACCOUNT_ALREADY_EXISTS") {
        throw conflictWithCode("STAFF_ACCOUNT_ALREADY_EXISTS", "An account already uses this email or employee code.");
      }
      throw error;
    }
  }

  async beginLogin(emailInput: string, passwordInput: string, deviceFingerprint?: string, ipHash?: string): Promise<BeginStaffLoginResult> {
    const email = normalizeEmail(emailInput);
    const bucket = this.loginFailures.get(email);
    const now = this.clock();
    if (bucket && now - bucket.startedAt < 10 * 60 * 1000 && bucket.attempts >= MAX_FAILURES) throw rateLimited("Too many staff login attempts.", 60);
    const staff = await this.options.repository.findStaffByEmail(email);
    const password = assertPassword(passwordInput);
    if (!staff || staff.status !== "ACTIVE" || !staff.passwordSalt || !staff.passwordDigest || !(await verifyPasswordAsync(password, staff.passwordSalt, staff.passwordDigest))) {
      this.recordLoginFailure(email);
      throw unauthorized("Staff credentials are invalid.");
    }
    const isAdmin = hasActiveRole(staff, "ADMIN", this.environmentScope, now);
    const isOperations = hasActiveRole(staff, "OPERATIONS", this.environmentScope, now);
    if (!isAdmin && !isOperations) throw unauthorized("Staff credentials are invalid.");
    this.loginFailures.delete(email);
    if (!isAdmin) {
      const sessionResult = await this.createSession(staff, deviceFingerprint, ipHash);
      await this.options.repository.appendAudit({ id: randomUUID(), actorStaffId: staff.id, action: "STAFF_LOGIN", targetType: "STAFF", targetId: staff.id, outcome: "SUCCEEDED", reasonCode: null, requestId: null, traceId: null, correlationId: null, beforeVersion: null, afterVersion: null, metadata: { method: "PASSWORD_ONLY_OPERATIONS" } });
      return { mfaRequired: false, ...sessionResult };
    }
    const credential = await this.options.repository.findMfaCredential(staff.id);
    if (!credential) throw conflictWithCode("STAFF_MFA_REQUIRED", "Admin MFA enrollment is required.");
    const challengeId = randomUUID();
    const expiresAt = new Date(now + LOGIN_CHALLENGE_TTL_MS).toISOString();
    await this.options.repository.createChallenge({ id: challengeId, staffId: staff.id, purpose: "LOGIN", expiresAt, attempts: 0, consumedAt: null });
    return { mfaRequired: true, challengeId, expiresAt };
  }

  async verifyLoginMfa(challengeId: string, codeInput: string, deviceFingerprint?: string, ipHash?: string): Promise<{ staff: StaffRecord; tokens: AdminTokenSet }> {
    const code = assertCode(codeInput);
    const challenge = await this.options.repository.findChallenge(challengeId);
    if (!challenge || challenge.purpose !== "LOGIN" || challenge.consumedAt || Date.parse(challenge.expiresAt) <= this.clock()) throw unauthorized("Staff MFA challenge is invalid or expired.");
    const staff = await this.options.repository.findStaffById(challenge.staffId);
    const credential = staff ? await this.options.repository.findMfaCredential(staff.id) : null;
    if (!staff || staff.status !== "ACTIVE" || !hasActiveRole(staff, "ADMIN", this.environmentScope, this.clock()) || !credential) throw unauthorized("Staff MFA challenge is invalid or expired.");
    const secret = this.options.encryption.decrypt(credential.secretCiphertext, credential.encryptionKeyId, this.encryptionContext(credential.id, staff.id));
    const validation = validateTotp(secret, code, this.clock(), 1);
    if (!validation.valid || validation.timeStep === null || !(await this.options.repository.acceptMfaTimeStep(credential.id, validation.timeStep))) {
      const attempts = await this.options.repository.recordChallengeFailure(challenge.id);
      if (attempts >= MAX_FAILURES) await this.options.repository.consumeChallenge(challenge.id);
      throw unauthorized("Staff MFA code is invalid.");
    }
    if (!(await this.options.repository.consumeChallenge(challenge.id))) throw unauthorized("Staff MFA challenge is invalid or expired.");
    const sessionResult = await this.createSession(staff, deviceFingerprint, ipHash);
    await this.options.repository.appendAudit({ id: randomUUID(), actorStaffId: staff.id, action: "STAFF_LOGIN", targetType: "STAFF", targetId: staff.id, outcome: "SUCCEEDED", reasonCode: null, requestId: null, traceId: null, correlationId: null, beforeVersion: null, afterVersion: null, metadata: { method: "PASSWORD_TOTP" } });
    return sessionResult;
  }

  async authenticate(accessToken: string): Promise<{ staff: StaffRecord; session: StaffSessionRecord; subject: AdminSubject }> {
    const session = await this.options.repository.findSession(hashOpaqueToken(accessToken));
    if (!session || session.revokedAt || Date.parse(session.absoluteExpiresAt) <= this.clock() || Date.parse(session.idleExpiresAt) <= this.clock()) throw unauthorized("Staff session is expired.");
    const staff = await this.options.repository.findStaffById(session.staffId);
    if (!staff || staff.status !== "ACTIVE") throw conflictWithCode("STAFF_ACCOUNT_LOCKED", "Staff account is not active.");
    if (staff.authorizationVersion !== session.authorizationVersion) throw unauthorized("Staff session has been invalidated.");
    await this.options.repository.touchSession(session.id, new Date(this.clock() + IDLE_TIMEOUT_MS).toISOString());
    return { staff, session, subject: { staffId: staff.id, status: staff.status, authorizationVersion: staff.authorizationVersion, roles: staff.roles, mfaVerifiedAt: session.stepUpVerifiedAt, stepUpVerifiedAt: session.stepUpVerifiedAt } };
  }

  async verifyCsrf(accessToken: string, csrfToken: string): Promise<void> {
    if (!csrfToken?.trim()) throw unauthorized("CSRF token is required.");
    const session = await this.options.repository.findSession(hashOpaqueToken(accessToken));
    if (!session || session.revokedAt || session.csrfTokenHash !== hashOpaqueToken(csrfToken)) throw conflictWithCode("CSRF_INVALID", "CSRF token is invalid.");
  }

  async stepUp(accessToken: string, codeInput: string): Promise<void> {
    const { staff, session } = await this.authenticate(accessToken);
    if (!hasActiveRole(staff, "ADMIN", this.environmentScope, this.clock())) throw unauthorized("TOTP step-up is available to Admin accounts only.");
    const code = assertCode(codeInput);
    const credential = await this.options.repository.findMfaCredential(staff.id);
    if (!credential) throw conflictWithCode("STAFF_MFA_REQUIRED", "Fresh step-up MFA is required.");
    const validation = validateTotp(this.options.encryption.decrypt(credential.secretCiphertext, credential.encryptionKeyId, this.encryptionContext(credential.id, staff.id)), code, this.clock(), 1);
    if (!validation.valid || validation.timeStep === null || !(await this.options.repository.acceptMfaTimeStep(credential.id, validation.timeStep))) {
      await this.options.repository.appendAudit({ id: randomUUID(), actorStaffId: staff.id, action: "STAFF_STEP_UP_FAILED", targetType: "STAFF", targetId: staff.id, outcome: "DENIED", reasonCode: "INVALID_MFA", requestId: null, traceId: null, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} });
      throw unauthorized("Staff step-up MFA is invalid.");
    }
    await this.options.repository.touchSession(session.id, new Date(this.clock() + IDLE_TIMEOUT_MS).toISOString(), nowIso(this.clock));
    await this.options.repository.appendAudit({ id: randomUUID(), actorStaffId: staff.id, action: "STAFF_STEP_UP_SUCCEEDED", targetType: "STAFF", targetId: staff.id, outcome: "SUCCEEDED", reasonCode: null, requestId: null, traceId: null, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} });
  }

  async requireFreshStepUp(accessToken: string): Promise<{ staff: StaffRecord; session: StaffSessionRecord; subject: AdminSubject }> {
    const result = await this.authenticate(accessToken);
    const verifiedAt = result.session.stepUpVerifiedAt;
    if (!verifiedAt || this.clock() - Date.parse(verifiedAt) > STEP_UP_MAX_AGE_MS) throw conflictWithCode("STAFF_MFA_REQUIRED", "Fresh step-up MFA is required.");
    return result;
  }

  async refresh(refreshToken: string): Promise<AdminTokenSet> {
    const old = await this.options.repository.findSessionByRefreshHash(hashOpaqueToken(refreshToken));
    if (!old || old.revokedAt || Date.parse(old.absoluteExpiresAt) <= this.clock()) throw unauthorized("Staff refresh session is invalid or expired.");
    const staff = await this.options.repository.findStaffById(old.staffId);
    if (!staff || staff.status !== "ACTIVE" || staff.authorizationVersion !== old.authorizationVersion) throw unauthorized("Staff refresh session is invalid or expired.");
    await this.options.repository.revokeSession(old.id, "refresh-rotation");
    return (await this.createSession(staff)).tokens;
  }

  async logout(accessToken: string): Promise<void> { const { session, staff } = await this.authenticate(accessToken); await this.options.repository.revokeSession(session.id, "logout"); await this.options.repository.appendAudit({ id: randomUUID(), actorStaffId: staff.id, action: "STAFF_LOGOUT", targetType: "STAFF", targetId: staff.id, outcome: "SUCCEEDED", reasonCode: null, requestId: null, traceId: null, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} }); }
  listSessions(accessToken: string) { return this.authenticate(accessToken).then(({ staff }) => this.options.repository.listSessions(staff.id)); }

  subjectFor(staff: StaffRecord, session: StaffSessionRecord): AdminSubject { return { staffId: staff.id, status: staff.status, authorizationVersion: staff.authorizationVersion, roles: staff.roles, mfaVerifiedAt: session.stepUpVerifiedAt, stepUpVerifiedAt: session.stepUpVerifiedAt }; }

  private encryptionContext(recordId: string, staffId: string) {
    return { environment: this.environmentScope, recordType: "admin-mfa", recordId, subjectId: staffId, schemaVersion: "026" };
  }

  private async createSession(staff: StaffRecord, deviceFingerprint?: string, ipHash?: string): Promise<{ staff: StaffRecord; tokens: AdminTokenSet }> {
    const accessToken = createOpaqueToken(); const refreshToken = createOpaqueToken(); const csrfToken = createOpaqueToken(); const now = this.clock();
    await this.options.repository.createSession({ id: randomUUID(), staffId: staff.id, accessTokenHash: hashOpaqueToken(accessToken), refreshTokenHash: hashOpaqueToken(refreshToken), familyId: randomUUID(), authorizationVersion: staff.authorizationVersion, idleExpiresAt: new Date(now + IDLE_TIMEOUT_MS).toISOString(), absoluteExpiresAt: new Date(now + ABSOLUTE_TIMEOUT_MS).toISOString(), lastSeenAt: new Date(now).toISOString(), csrfTokenHash: hashOpaqueToken(csrfToken), deviceFingerprint: deviceFingerprint ? hashOpaqueToken(deviceFingerprint) : null, ipHash: ipHash ? hashOpaqueToken(ipHash) : null, stepUpVerifiedAt: null, revokedAt: null });
    return { staff, tokens: { accessToken, refreshToken, csrfToken, expiresInSeconds: Math.floor(IDLE_TIMEOUT_MS / 1000) } };
  }
  private recordLoginFailure(email: string): void { const now = this.clock(); const current = this.loginFailures.get(email); if (!current || now - current.startedAt >= 10 * 60 * 1000) this.loginFailures.set(email, { startedAt: now, attempts: 1 }); else current.attempts += 1; }
}
