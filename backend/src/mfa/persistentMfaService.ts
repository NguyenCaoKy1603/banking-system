import {
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { conflictWithCode, invalidRequest, notFound, rateLimited, unauthorized } from "../errors.js";
import { AnomalyRepository } from "../database/repositories/anomalyRepository.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { MfaRepository, type MfaChallengeRow, type MfaCredentialRow } from "../database/repositories/mfaRepository.js";
import { OutboxRepository } from "../database/repositories/outboxRepository.js";
import { evaluateTransferAnomaly } from "../domain/anomaly/index.js";
import { createId, createOpaqueToken, fingerprint, hashOpaqueToken } from "../security.js";
import {
  buildTotpUri,
  generateBiometricSecret,
  generateTotpSecret,
  OtpDigestKeyring,
  SecureOtpCodeGenerator,
  type KeyEncryptionPort,
  type OtpCodeGenerator,
  validateTotp,
  verifyBiometricAssertion,
} from "./crypto.js";
import {
  NullEmailProvider,
  type DeliveryResult,
  type VerificationCodeDeliveryInput,
  type VerificationCodeDeliveryPort,
} from "./delivery.js";
import { MfaMetrics } from "./metrics.js";

const EMAIL_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TOTP_ENROLLMENT_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const DEFAULT_RECOVERY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RECOVERY_REQUEST_TTL_MS = 15 * 60 * 1000;
export const BIOMETRIC_TRANSFER_MAX_AMOUNT_MINOR = 1_000_000n;

export type MfaChallengePurpose =
  | "REGISTRATION_EMAIL_VERIFY"
  | "EMAIL_CHANGE_VERIFY"
  | "RECOVERY_EMAIL_VERIFY"
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGE"
  | "LOGIN"
  | "TRANSFER"
  | "SAVINGS_OPENING"
  | "SAVINGS_WITHDRAWAL"
  | "CREDIT_APPLICATION"
  | "CARD_ACTIVATION"
  | "CREDIT_PAYMENT"
  | "CARD_UNLOCK"
  | "CARD_REPORT_LOST"
  | "MFA_TOTP_ENROLLMENT"
  | "MFA_FACTOR_CHANGE"
  | "MFA_FACTOR_REMOVAL"
  | "MFA_RECOVERY"
  | "RECOVERY_CODE_ROTATION";

export type MfaChallengeResponse = {
  challengeId: string;
  method: "EMAIL_OTP" | "TOTP" | "BIOMETRIC";
  /** The wire contract keeps the selected factor in an array for Mobile. */
  methods: Array<"EMAIL_OTP" | "TOTP" | "BIOMETRIC" | "OTP">;
  purpose: MfaChallengePurpose;
  expiresAt: string;
  resendAfter?: string;
  maskedDestination?: string;
};

export type BiometricEnrollmentResponse = {
  credentialId: string;
  credentialType: "BIOMETRIC";
  deviceId: string;
  displayName: string;
  status: "ACTIVE";
  biometricSecret: string;
  enrolledAt: string;
};

export type TotpEnrollmentResponse = {
  credentialId: string;
  status: "PENDING";
  expiresAt: string;
  manualSetupKey: string;
  otpauthUri: string;
};

export type TotpConfirmationResponse = {
  credentialId: string;
  status: "ACTIVE";
  recoveryCodes: string[];
};

export type MfaCredentialSummary = Omit<MfaCredentialRow, "secretCiphertext" | "secretKeyId">;

export type PersistentMfaServiceOptions = {
  unitOfWork: UnitOfWork;
  encryption: KeyEncryptionPort;
  otpDigestKeyring: OtpDigestKeyring;
  environmentScope?: string;
  delivery?: VerificationCodeDeliveryPort;
  codeGenerator?: OtpCodeGenerator;
  clock?: () => number;
  metrics?: MfaMetrics;
};

function maskEmail(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split("@", 2);
  if (!local || !domain) return "masked destination";
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function digestRecoveryCode(code: string, salt: Buffer): string {
  return pbkdf2Sync(code, salt, 180_000, 32, "sha256").toString("hex");
}

function generateRecoveryCode(): { plaintext: string; salt: Buffer; digest: string } {
  const plaintext = randomBytes(16).toString("base64url");
  const salt = randomBytes(16);
  return { plaintext, salt, digest: digestRecoveryCode(plaintext, salt) };
}

function envelopeMetadata(ciphertext: string): { version: string; aadVersion: string | null; algorithm: string; encryptedDataKey: string | null } {
  const parts = ciphertext.split(".");
  return {
    version: parts[0] === "v2" ? "v2" : "v1",
    aadVersion: parts[0] === "v2" ? parts[2] ?? null : null,
    algorithm: parts[0] === "v2" ? "AES-256-GCM-ENVELOPE" : "AES-256-GCM",
    encryptedDataKey: parts[0] === "v2" ? parts[6] ?? null : null,
  };
}

function assertSixDigits(value: string): string {
  if (!/^\d{6}$/.test(value)) {
    throw invalidRequest("MFA code must contain exactly six digits.", {
      proof: "MFA code must contain exactly six digits.",
    });
  }
  return value;
}

function challengePurposeRequiresConflict(purpose: string): boolean {
  return (
    purpose !== "LOGIN" &&
    purpose !== "PASSWORD_RESET" &&
    !purpose.startsWith("REGISTRATION_") &&
    !purpose.startsWith("EMAIL_")
  );
}

export class PersistentMfaService {
  private readonly delivery: VerificationCodeDeliveryPort;
  private readonly codeGenerator: OtpCodeGenerator;
  private readonly clock: () => number;
  readonly metrics: MfaMetrics;

  constructor(private readonly options: PersistentMfaServiceOptions) {
    this.delivery = options.delivery ?? new NullEmailProvider();
    this.codeGenerator = options.codeGenerator ?? new SecureOtpCodeGenerator();
    this.clock = options.clock ?? (() => Date.now());
    this.metrics = options.metrics ?? new MfaMetrics();
  }

  private encryptionContext(recordType: string, recordId: string, customerId: string) {
    return { environment: this.options.environmentScope ?? process.env.BANKING_ENV ?? "preview", recordType, recordId, subjectId: customerId, schemaVersion: "026" };
  }

  async listCredentials(customerId: string): Promise<MfaCredentialSummary[]> {
    return this.options.unitOfWork.transaction(async ({ client }) => {
      const credentials = await new MfaRepository(client).listCredentials(customerId);
      return credentials.map(({ secretCiphertext: _secretCiphertext, secretKeyId: _secretKeyId, ...summary }) => summary);
    });
  }

  async revokeCredential(customerId: string, credentialId: string, allowLastFactor = false): Promise<void> {
    return this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const credential = await repository.lockCredential(credentialId);
      if (!credential || credential.customerId !== customerId || credential.status === "REVOKED") {
        throw notFound("MFA credential not found.");
      }
      const active = (await repository.listCredentials(customerId)).filter((item) => item.status === "ACTIVE");
      if (!allowLastFactor && active.length <= 1 && credential.status === "ACTIVE") {
        throw conflictWithCode("MFA_LAST_FACTOR", "Không thể xóa phương thức MFA cuối cùng.");
      }
      await repository.revokeCredential(credentialId, "user-request");
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId,
        eventType: "MFA_FACTOR_REVOKED",
        purpose: "MFA_FACTOR_REMOVAL",
        resourceId: credentialId,
      });
      this.metrics.increment("mfa_credentials_revoked_total");
    });
  }

  async beginTotpEnrollment(input: {
    customerId: string;
    email: string;
    displayName?: string;
  }): Promise<TotpEnrollmentResponse> {
    const secret = generateTotpSecret();
    const credentialId = createId("mfa-credential");
    const createdAt = this.clock();
    const encryptedSecret = this.options.encryption.encrypt(secret, this.encryptionContext("mfa-totp", credentialId, input.customerId));
    const metadata = envelopeMetadata(encryptedSecret);
    await this.options.unitOfWork.transaction(async ({ client }) => {
      await client.query(
        `UPDATE mfa_credentials
         SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
         WHERE customer_id = $1 AND status = 'PENDING'`,
        [input.customerId],
      );
      await new MfaRepository(client).createTotpCredential({
        id: credentialId,
        customerId: input.customerId,
        displayName: input.displayName?.trim() || "Authenticator",
        secretCiphertext: encryptedSecret,
        secretKeyId: this.options.encryption.keyId,
        secretCipherVersion: metadata.version,
        secretAadVersion: metadata.aadVersion,
        secretEncryptionAlgorithm: metadata.algorithm,
        secretEncryptedDataKey: metadata.encryptedDataKey,
      });
      await new MfaRepository(client).insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId: input.customerId,
        eventType: "MFA_ENROLLMENT_STARTED",
        purpose: "MFA_TOTP_ENROLLMENT",
        resourceId: credentialId,
        metadata: { credentialType: "TOTP" },
      });
    });
    return {
      credentialId,
      status: "PENDING",
      expiresAt: new Date(createdAt + TOTP_ENROLLMENT_TTL_MS).toISOString(),
      manualSetupKey: secret,
      otpauthUri: buildTotpUri(secret, input.email),
    };
  }

  /**
   * Recovery is deliberately a separate entry point: it accepts only the
   * one-time recovery token after the configured cooldown and never accepts a
   * bearer session as a substitute for the recovery proof.
   */
  async beginRecoveryTotpEnrollment(input: {
    recoveryToken: string;
    displayName?: string;
  }): Promise<TotpEnrollmentResponse> {
    const secret = generateTotpSecret();
    const credentialId = createId("mfa-credential");
    const createdAt = this.clock();
    let customerId = "";
    let email = "";
    await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const request = await repository.lockRecoveryRequest(hashOpaqueToken(input.recoveryToken));
      if (!request || String(request.status) !== "COMPLETED" || Date.parse(String(request.expires_at)) <= this.clock()) {
        throw unauthorized("MFA recovery enrollment is invalid or expired.");
      }
      customerId = String(request.customer_id);
      const customer = await client.query<{ email?: string }>(
        "SELECT email FROM customers WHERE id = $1",
        [customerId],
      );
      email = String(customer.rows[0]?.email ?? "");
      if (!email) {
        throw unauthorized("MFA recovery enrollment is invalid or expired.");
      }
      const encryptedSecret = this.options.encryption.encrypt(secret, this.encryptionContext("mfa-totp", credentialId, customerId));
      const metadata = envelopeMetadata(encryptedSecret);
      await repository.createTotpCredential({
        id: credentialId,
        customerId,
        displayName: input.displayName?.trim() || "Recovery authenticator",
        secretCiphertext: encryptedSecret,
        secretKeyId: this.options.encryption.keyId,
        secretCipherVersion: metadata.version,
        secretAadVersion: metadata.aadVersion,
        secretEncryptionAlgorithm: metadata.algorithm,
        secretEncryptedDataKey: metadata.encryptedDataKey,
      });
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId,
        eventType: "MFA_ENROLLMENT_STARTED",
        purpose: "MFA_RECOVERY",
        resourceId: credentialId,
      });
    });
    return {
      credentialId,
      status: "PENDING",
      expiresAt: new Date(createdAt + TOTP_ENROLLMENT_TTL_MS).toISOString(),
      manualSetupKey: secret,
      otpauthUri: buildTotpUri(secret, email),
    };
  }

  async confirmTotpEnrollment(input: {
    customerId?: string;
    recoveryToken?: string;
    credentialId: string;
    code: string;
  }): Promise<TotpConfirmationResponse> {
    const code = assertSixDigits(input.code);
    const now = this.clock();
    return this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      let customerId = input.customerId;
      if (input.recoveryToken) {
        const request = await repository.lockRecoveryRequest(hashOpaqueToken(input.recoveryToken));
        if (!request || String(request.status) !== "COMPLETED" || Date.parse(String(request.expires_at)) <= now) {
          throw unauthorized("MFA recovery enrollment is invalid or expired.");
        }
        customerId = String(request.customer_id);
      }
      if (!customerId) {
        throw unauthorized("MFA enrollment session is invalid.");
      }
      const credential = await repository.lockCredential(input.credentialId);
      if (!credential || credential.customerId !== customerId || credential.status !== "PENDING") {
        throw unauthorized("MFA enrollment is invalid or expired.");
      }
      if (credential.createdAt && Date.parse(credential.createdAt) + TOTP_ENROLLMENT_TTL_MS <= now) {
        await repository.revokeCredential(credential.id, "enrollment-expired");
        throw unauthorized("MFA enrollment is invalid or expired.");
      }
      if (!credential.secretCiphertext || !credential.secretKeyId) {
        throw unauthorized("MFA enrollment secret is unavailable.");
      }
      const secret = this.options.encryption.decrypt(credential.secretCiphertext, credential.secretKeyId, this.encryptionContext("mfa-totp", credential.id, customerId));
      const validation = validateTotp(secret, code, now, 1);
      if (!validation.valid || validation.timeStep === null || !(await repository.activateCredential(credential.id, validation.timeStep))) {
        await repository.insertSecurityEvent({
          id: createId("auth-security-event"),
          customerId,
          eventType: "MFA_VERIFY_FAILED",
          purpose: "MFA_TOTP_ENROLLMENT",
          resourceId: credential.id,
        });
        this.metrics.increment("auth_challenges_failed_total");
        throw unauthorized("MFA enrollment code is invalid.");
      }

      await repository.revokeCustomerRecoveryCodes(customerId);
      const recoveryCodes: string[] = [];
      for (let index = 0; index < RECOVERY_CODE_COUNT; index += 1) {
        const generated = generateRecoveryCode();
        recoveryCodes.push(generated.plaintext);
        await repository.createRecoveryCode({
          id: createId("mfa-recovery-code"),
          customerId,
          codeDigest: generated.digest,
          salt: generated.salt.toString("hex"),
        });
      }
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId,
        eventType: "MFA_ENROLLED",
        purpose: "MFA_TOTP_ENROLLMENT",
        resourceId: credential.id,
        metadata: { recoveryCodeCount: recoveryCodes.length },
      });
      this.metrics.increment("mfa_credentials_enrolled_total");
      return { credentialId: credential.id, status: "ACTIVE", recoveryCodes };
    });
  }

  async beginLoginChallenge(input: {
    customerId: string;
    deviceId: string;
    credentialId?: string;
    networkFingerprint?: string | null;
  }): Promise<MfaChallengeResponse> {
    return this.beginTotpChallenge({
      customerId: input.customerId,
      deviceId: input.deviceId,
      credentialId: input.credentialId,
      purpose: "LOGIN",
      networkFingerprint: input.networkFingerprint,
    });
  }

  async beginTotpChallenge(input: {
    customerId: string;
    deviceId: string;
    purpose: Exclude<MfaChallengePurpose, "REGISTRATION_EMAIL_VERIFY" | "EMAIL_CHANGE_VERIFY" | "RECOVERY_EMAIL_VERIFY">;
    resourceId?: string | null;
    requestFingerprint?: string | null;
    credentialId?: string;
    networkFingerprint?: string | null;
  }): Promise<MfaChallengeResponse> {
    const challengeId = createOpaqueToken();
    const challengeHash = hashOpaqueToken(challengeId);
    const expiresAt = new Date(this.clock() + EMAIL_CHALLENGE_TTL_MS).toISOString();
    await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const credential = input.credentialId
        ? await repository.lockCredential(input.credentialId)
        : await repository.findActiveTotp(input.customerId);
      if (!credential || credential.customerId !== input.customerId || credential.status !== "ACTIVE") {
        throw unauthorized("MFA credential is not active.");
      }
      const customerRate = await repository.atomicRateLimit({
        bucketKey: `mfa-challenge:customer:${input.customerId}:${input.purpose}`,
        windowSeconds: 600,
        maxAttempts: 10,
      });
      const deviceRate = await repository.atomicRateLimit({
        bucketKey: `mfa-challenge:device:${fingerprint(input.deviceId)}`,
        windowSeconds: 3600,
        maxAttempts: 20,
      });
      const networkRate = input.networkFingerprint
        ? await repository.atomicRateLimit({
            bucketKey: `mfa-challenge:network:${fingerprint(input.networkFingerprint)}`,
            windowSeconds: 3600,
            maxAttempts: 50,
          })
        : { allowed: true, retryAfterSeconds: 0 };
      if (!customerRate.allowed || !deviceRate.allowed || !networkRate.allowed) {
        this.metrics.increment("auth_challenges_rate_limited_total");
        throw rateLimited(
          "Too many MFA challenge requests.",
          Math.max(customerRate.retryAfterSeconds, deviceRate.retryAfterSeconds, networkRate.retryAfterSeconds),
        );
      }
      // A new challenge for the same transaction/login context supersedes
      // every older active challenge. This prevents an earlier proof from
      // remaining usable after a retry or quote refresh.
      await repository.cancelActiveChallenges({
        customerId: input.customerId,
        deviceId: input.deviceId,
        purpose: input.purpose,
        resourceId: input.resourceId,
        requestFingerprint: input.requestFingerprint,
      });
      await repository.createChallenge({
        id: challengeHash,
        customerId: input.customerId,
        credentialId: credential.id,
        deviceId: input.deviceId,
        method: "TOTP",
        purpose: input.purpose,
        resourceId: input.resourceId,
        requestFingerprint: input.requestFingerprint,
        expiresAt,
        maxAttempts: 5,
      });
    });
    this.metrics.increment("auth_challenges_created_total");
    return { challengeId, method: "TOTP", methods: ["TOTP"], purpose: input.purpose, expiresAt };
  }

  async enrollBiometricCredential(input: {
    customerId: string;
    deviceId: string;
    displayName?: string;
  }): Promise<BiometricEnrollmentResponse> {
    const normalizedDeviceId = input.deviceId.trim();
    if (!normalizedDeviceId) {
      throw invalidRequest("X-Device-ID is required to enroll biometric authentication.");
    }
    const biometricSecret = generateBiometricSecret();
    const credentialId = createId("mfa-credential");
    const enrolledAt = new Date(this.clock()).toISOString();
    const encryptedSecret = this.options.encryption.encrypt(
      biometricSecret,
      this.encryptionContext("mfa-biometric", credentialId, input.customerId),
    );
    const metadata = envelopeMetadata(encryptedSecret);
    const deviceSuffix = fingerprint(normalizedDeviceId).slice(0, 6);
    const displayName = input.displayName?.trim()
      ? `${input.displayName.trim()} (${deviceSuffix})`
      : `Sinh trắc học thiết bị (${deviceSuffix})`;

    await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      await repository.revokeActiveBiometricByDevice(input.customerId, normalizedDeviceId);
      await repository.createBiometricCredential({
        id: credentialId,
        customerId: input.customerId,
        deviceId: normalizedDeviceId,
        displayName,
        secretCiphertext: encryptedSecret,
        secretKeyId: this.options.encryption.keyId,
        secretCipherVersion: metadata.version,
        secretAadVersion: metadata.aadVersion,
        secretEncryptionAlgorithm: metadata.algorithm,
        secretEncryptedDataKey: metadata.encryptedDataKey,
      });
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId: input.customerId,
        eventType: "MFA_BIOMETRIC_ENROLLED",
        purpose: "MFA_FACTOR_CHANGE",
        deviceFingerprint: fingerprint(normalizedDeviceId),
        resourceId: credentialId,
        metadata: { credentialType: "BIOMETRIC" },
      });
    });

    this.metrics.increment("mfa_credentials_enrolled_total");
    return {
      credentialId,
      credentialType: "BIOMETRIC",
      deviceId: normalizedDeviceId,
      displayName,
      status: "ACTIVE",
      biometricSecret,
      enrolledAt,
    };
  }

  async beginBiometricChallenge(input: {
    customerId: string;
    deviceId: string;
    purpose: Exclude<MfaChallengePurpose, "REGISTRATION_EMAIL_VERIFY" | "EMAIL_CHANGE_VERIFY" | "RECOVERY_EMAIL_VERIFY">;
    resourceId?: string | null;
    requestFingerprint?: string | null;
    networkFingerprint?: string | null;
  }): Promise<MfaChallengeResponse> {
    const challengeId = createOpaqueToken();
    const challengeHash = hashOpaqueToken(challengeId);
    const expiresAt = new Date(this.clock() + EMAIL_CHALLENGE_TTL_MS).toISOString();
    await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const credential = await repository.findActiveBiometric(input.customerId, input.deviceId);
      if (!credential || credential.customerId !== input.customerId || credential.status !== "ACTIVE") {
        throw unauthorized("Biometric credential is not active for this device.");
      }
      if (input.purpose === "TRANSFER" && input.resourceId) {
        const quoteResult = await client.query<{
          customer_id: string;
          source_account_id: string;
          destination_account_id: string | null;
          beneficiary_id: string | null;
          amount_minor: string;
          fee_minor: string;
        }>(
          `SELECT customer_id, source_account_id, destination_account_id,
                  beneficiary_id, amount_minor::text, fee_minor::text
             FROM transfer_quotes
            WHERE id = $1`,
          [input.resourceId],
        );
        const quote = quoteResult.rows[0];
        if (quote && String(quote.customer_id) === input.customerId) {
          const amountMinor = BigInt(String(quote.amount_minor));
          if (amountMinor > BIOMETRIC_TRANSFER_MAX_AMOUNT_MINOR) {
            throw conflictWithCode(
              "BIOMETRIC_TIER_LIMIT_EXCEEDED",
              "Giao dịch trên 1.000.000 VND bắt buộc xác thực bằng mã TOTP.",
            );
          }
          if (quote.destination_account_id) {
            const accountResult = await client.query<{ available_minor: string }>(
              `SELECT available_minor::text FROM payment_accounts WHERE id = $1`,
              [quote.source_account_id],
            );
            const availableMinor = BigInt(String(accountResult.rows[0]?.available_minor ?? "0"));
            const nowIso = new Date(this.clock()).toISOString();
            const riskSignals = await new AnomalyRepository(client).getTransferRiskSignals({
              customerId: input.customerId,
              destinationAccountId: String(quote.destination_account_id),
              now: nowIso,
            });
            const anomaly = evaluateTransferAnomaly({
              amountMinor,
              feeMinor: BigInt(String(quote.fee_minor)),
              availableBalanceMinor: availableMinor,
              isNewRecipient: !quote.beneficiary_id && !riskSignals.hasPriorRelationship,
              recentTransfersLast10mCount: riskSignals.recentTransfersLast10mCount,
              sameRecipientLast15mCount: riskSignals.sameRecipientLast15mCount,
              occurredAt: nowIso,
            });
            if (anomaly.riskLevel === "HIGH" || anomaly.riskLevel === "CRITICAL") {
              throw conflictWithCode(
                "BIOMETRIC_HIGH_RISK_NOT_ALLOWED",
                "Giao dịch có cảnh báo rủi ro cao bắt buộc xác thực bằng mã TOTP.",
              );
            }
          }
        }
      }
      const customerRate = await repository.atomicRateLimit({
        bucketKey: `mfa-challenge:customer:${input.customerId}:${input.purpose}`,
        windowSeconds: 600,
        maxAttempts: 10,
      });
      const deviceRate = await repository.atomicRateLimit({
        bucketKey: `mfa-challenge:device:${fingerprint(input.deviceId)}`,
        windowSeconds: 3600,
        maxAttempts: 20,
      });
      const networkRate = input.networkFingerprint
        ? await repository.atomicRateLimit({
            bucketKey: `mfa-challenge:network:${fingerprint(input.networkFingerprint)}`,
            windowSeconds: 3600,
            maxAttempts: 50,
          })
        : { allowed: true, retryAfterSeconds: 0 };
      if (!customerRate.allowed || !deviceRate.allowed || !networkRate.allowed) {
        this.metrics.increment("auth_challenges_rate_limited_total");
        throw rateLimited(
          "Too many MFA challenge requests.",
          Math.max(customerRate.retryAfterSeconds, deviceRate.retryAfterSeconds, networkRate.retryAfterSeconds),
        );
      }
      await repository.cancelActiveChallenges({
        customerId: input.customerId,
        deviceId: input.deviceId,
        purpose: input.purpose,
        resourceId: input.resourceId,
        requestFingerprint: input.requestFingerprint,
      });
      await repository.createChallenge({
        id: challengeHash,
        customerId: input.customerId,
        credentialId: credential.id,
        deviceId: input.deviceId,
        method: "BIOMETRIC",
        purpose: input.purpose,
        resourceId: input.resourceId,
        requestFingerprint: input.requestFingerprint,
        expiresAt,
        maxAttempts: 5,
      });
    });
    this.metrics.increment("auth_challenges_created_total");
    return { challengeId, method: "BIOMETRIC", methods: ["BIOMETRIC"], purpose: input.purpose, expiresAt };
  }

  async createEmailChallenge(input: {
    customerId?: string | null;
    pendingRegistrationId?: string | null;
    deviceId: string;
    purpose: MfaChallengePurpose;
    destination?: string;
    resourceId?: string | null;
    requestFingerprint?: string | null;
    networkFingerprint?: string | null;
  }): Promise<MfaChallengeResponse> {
    const challengeId = createOpaqueToken();
    const challengeHash = hashOpaqueToken(challengeId);
    const code = this.codeGenerator.generate();
    const expiresAt = new Date(this.clock() + EMAIL_CHALLENGE_TTL_MS).toISOString();
    const sentAt = new Date(this.clock()).toISOString();
    const digest = this.options.otpDigestKeyring.digest(challengeHash, code);
    let resolvedDestination = input.destination ?? "";
    await this.options.unitOfWork.transaction(async ({ client }) => {
      if (!resolvedDestination && input.customerId) {
        const custRes = await client.query(`SELECT email FROM customers WHERE id = $1`, [input.customerId]);
        if (custRes.rows.length > 0) {
          resolvedDestination = custRes.rows[0].email;
        }
      }
      await new MfaRepository(client).createChallenge({
        id: challengeHash,
        customerId: input.customerId,
        pendingRegistrationId: input.pendingRegistrationId,
        deviceId: input.deviceId,
        method: "EMAIL_OTP",
        purpose: input.purpose,
        resourceId: input.resourceId,
        requestFingerprint: input.requestFingerprint,
        proofDigest: digest,
        digestKeyId: this.options.otpDigestKeyring.currentKeyId,
        expiresAt,
        status: "PENDING_DELIVERY",
        lastSentAt: sentAt,
        createdDeviceFingerprint: fingerprint(input.deviceId),
        createdIpFingerprint: input.networkFingerprint ? fingerprint(input.networkFingerprint) : null,
      });
      if (input.purpose === "REGISTRATION_EMAIL_VERIFY" && input.pendingRegistrationId) {
        // The outbox records only the committed delivery intent.  The one-time
        // code is handed directly to the test/approved provider and is never
        // persisted in PostgreSQL, logs or an event payload.
        await new OutboxRepository(client).append({
          id: createId("registration-email-delivery"),
          eventType: "security.registration_otp_requested",
          aggregateType: "registration",
          aggregateId: input.pendingRegistrationId,
          deduplicationKey: `registration-email-delivery:${challengeHash}`,
          occurredAt: sentAt,
          traceId: null,
          payload: {
            deliveryReference: challengeHash,
            pendingRegistrationId: input.pendingRegistrationId,
            destinationFingerprint: fingerprint(resolvedDestination),
            maskedDestination: maskEmail(resolvedDestination),
            expiresAt,
          },
        });
      }
    });

    const delivery: VerificationCodeDeliveryInput = {
      deliveryId: challengeHash,
      purpose: input.purpose,
      destination: resolvedDestination,
      code,
      expiresAt,
    };
    const result = await this.delivery.send(delivery);
    if (result.status === "FAILED") {
      this.metrics.increment("auth_delivery_failure_total");
      await this.options.unitOfWork.transaction(async ({ client }) => {
        await new MfaRepository(client).markChallengeDeliveryFailed(challengeHash);
        await new MfaRepository(client).insertSecurityEvent({
          id: createId("auth-security-event"),
          customerId: input.customerId,
          eventType: "OTP_DELIVERY_FAILED",
          purpose: input.purpose,
          challengeId: challengeHash,
          metadata: { reason: result.reason },
        });
      });
      throw conflictWithCode("OTP_DELIVERY_FAILED", "Không thể gửi mã xác nhận.");
    }
    this.metrics.increment("auth_delivery_success_total");
    this.metrics.increment("auth_challenges_created_total");
    await this.options.unitOfWork.transaction(async ({ client }) => {
      await client.query(
        `UPDATE auth_challenges SET status = 'ACTIVE', updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING_DELIVERY'`,
        [challengeHash],
      );
    });
    return {
      challengeId,
      method: "EMAIL_OTP",
      methods: ["EMAIL_OTP"],
      purpose: input.purpose,
      expiresAt,
      resendAfter: new Date(this.clock() + RESEND_COOLDOWN_MS).toISOString(),
      maskedDestination: maskEmail(resolvedDestination),
    };
  }

  async verifyChallenge(input: {
    challengeId: string;
    customerId?: string;
    deviceId: string;
    proof: string;
    purpose: MfaChallengePurpose;
    resourceId?: string | null;
    requestFingerprint?: string | null;
  }): Promise<{ customerId: string | null; credentialId: string | null; timeStep: number | null }> {
    const now = this.clock();
    const challengeHash = hashOpaqueToken(input.challengeId);
    const result = await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const challenge = await repository.lockChallenge(challengeHash);
      if (!challenge) {
        return { ok: false as const, reason: "missing" as const, customerId: null, credentialId: null, timeStep: null };
      }
      if (Date.parse(challenge.expiresAt) <= now) {
        await repository.expireChallenge(challengeHash);
        return { ok: false as const, reason: "expired" as const, customerId: challenge.customerId, credentialId: null, timeStep: null };
      }
      if (
        (input.customerId !== undefined && challenge.customerId !== input.customerId) ||
        challenge.deviceId !== input.deviceId ||
        challenge.purpose !== input.purpose ||
        (challenge.resourceId ?? null) !== (input.resourceId ?? null) ||
        (challenge.requestFingerprint ?? null) !== (input.requestFingerprint ?? null) ||
        challenge.status !== "ACTIVE"
      ) {
        await repository.recordChallengeFailure(challengeHash);
        return { ok: false as const, reason: "context" as const, customerId: challenge.customerId, credentialId: null, timeStep: null };
      }
      if (challenge.method === "EMAIL_OTP") {
        const valid = this.options.otpDigestKeyring.verify(
          challengeHash,
          typeof input.proof === "string" ? input.proof : "",
          challenge.proofDigest ?? "",
          challenge.digestKeyId ?? undefined,
        );
        if (!valid) {
          const failure = await repository.recordChallengeFailure(challengeHash);
          return { ok: false as const, reason: failure.locked ? "locked" as const : "invalid" as const, customerId: challenge.customerId, credentialId: null, timeStep: null };
        }
        await repository.consumeChallenge(challengeHash);
        await repository.insertSecurityEvent({
          id: createId("auth-security-event"),
          customerId: challenge.customerId,
          eventType: "MFA_VERIFY_SUCCEEDED",
          purpose: input.purpose,
          challengeId: challengeHash,
          resourceId: input.resourceId,
        });
        return { ok: true as const, reason: "ok" as const, customerId: challenge.customerId, credentialId: null, timeStep: null };
      }
      if (challenge.method === "BIOMETRIC") {
        const matchedBiometric = challenge.credentialId
          ? await repository.lockCredential(challenge.credentialId)
          : await repository.findActiveBiometric(challenge.customerId ?? "", input.deviceId);
        const credential = matchedBiometric && matchedBiometric.id !== challenge.credentialId
          ? await repository.lockCredential(matchedBiometric.id)
          : matchedBiometric;
        if (
          !credential ||
          credential.status !== "ACTIVE" ||
          credential.credentialType !== "BIOMETRIC" ||
          (credential.deviceId && credential.deviceId !== input.deviceId) ||
          !credential.secretCiphertext ||
          !credential.secretKeyId
        ) {
          await repository.recordChallengeFailure(challengeHash);
          return { ok: false as const, reason: "credential" as const, customerId: challenge.customerId, credentialId: null, timeStep: null };
        }
        const biometricSecret = this.options.encryption.decrypt(
          credential.secretCiphertext,
          credential.secretKeyId,
          this.encryptionContext("mfa-biometric", credential.id, challenge.customerId ?? "unknown"),
        );
        const biometricValid = verifyBiometricAssertion(input.proof, biometricSecret, {
          challengeId: input.challengeId,
          deviceId: input.deviceId,
          purpose: input.purpose,
          resourceId: input.resourceId,
        });
        if (!biometricValid) {
          const failure = await repository.recordChallengeFailure(challengeHash);
          return { ok: false as const, reason: failure.locked ? "locked" as const : "invalid" as const, customerId: challenge.customerId, credentialId: credential.id, timeStep: null };
        }
        await repository.touchCredentialUsed(credential.id);
        await repository.consumeChallenge(challengeHash);
        await repository.insertSecurityEvent({
          id: createId("auth-security-event"),
          customerId: challenge.customerId,
          eventType: "MFA_VERIFY_SUCCEEDED",
          purpose: input.purpose,
          challengeId: challengeHash,
          resourceId: input.resourceId,
          metadata: { method: "BIOMETRIC" },
        });
        return { ok: true as const, reason: "ok" as const, customerId: challenge.customerId, credentialId: credential.id, timeStep: null };
      }
      if (challenge.method !== "TOTP" || !challenge.credentialId) {
        await repository.recordChallengeFailure(challengeHash);
        return { ok: false as const, reason: "invalid" as const, customerId: challenge.customerId, credentialId: null, timeStep: null };
      }
      const credential = await repository.lockCredential(challenge.credentialId);
      if (!credential || credential.status !== "ACTIVE" || !credential.secretCiphertext || !credential.secretKeyId) {
        await repository.recordChallengeFailure(challengeHash);
        return { ok: false as const, reason: "credential" as const, customerId: challenge.customerId, credentialId: null, timeStep: null };
      }
      const secret = this.options.encryption.decrypt(credential.secretCiphertext, credential.secretKeyId, this.encryptionContext("mfa-totp", credential.id, challenge.customerId ?? "unknown"));
      const validation = /^\d{6}$/.test(input.proof)
        ? validateTotp(secret, input.proof, now, 1)
        : { valid: false, timeStep: null };
      if (!validation.valid || validation.timeStep === null || !(await repository.acceptTotpStep(credential.id, validation.timeStep))) {
        if (validation.valid && validation.timeStep !== null) {
          await repository.insertSecurityEvent({
            id: createId("auth-security-event"),
            customerId: challenge.customerId,
            eventType: "MFA_REPLAY_DETECTED",
            purpose: input.purpose,
            challengeId: challengeHash,
            resourceId: input.resourceId,
          });
        }
        const failure = await repository.recordChallengeFailure(challengeHash);
        return { ok: false as const, reason: failure.locked ? "locked" as const : validation.valid ? "replay" as const : "invalid" as const, customerId: challenge.customerId, credentialId: credential.id, timeStep: validation.timeStep };
      }
      await repository.consumeChallenge(challengeHash);
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId: challenge.customerId,
        eventType: "MFA_VERIFY_SUCCEEDED",
        purpose: input.purpose,
        challengeId: challengeHash,
        resourceId: input.resourceId,
      });
      return { ok: true as const, reason: "ok" as const, customerId: challenge.customerId, credentialId: credential.id, timeStep: validation.timeStep };
    });
    if (result.ok) {
      this.metrics.increment("auth_challenges_verified_total");
      return { customerId: result.customerId, credentialId: result.credentialId, timeStep: result.timeStep };
    }
    this.metrics.increment("auth_challenges_failed_total");
    if (result.reason === "missing" || result.reason === "expired" || result.reason === "credential") {
      throw unauthorized("MFA challenge is invalid or expired.");
    }
    if (result.reason === "replay") {
      this.metrics.increment("auth_challenges_replayed_total");
      throw conflictWithCode("MFA_REPLAY_DETECTED", "Mã xác thực đã được sử dụng.");
    }
    if (challengePurposeRequiresConflict(input.purpose)) {
      throw conflictWithCode("STEP_UP_VERIFICATION_FAILED", "Xác thực giao dịch không thành công.");
    }
    throw unauthorized("MFA challenge verification failed.");
  }

  async resendChallenge(input: {
    challengeId: string;
    customerId?: string;
    pendingRegistrationId?: string;
    deviceId: string;
    destination: string;
    networkFingerprint?: string | null;
  }): Promise<MfaChallengeResponse> {
    const oldHash = hashOpaqueToken(input.challengeId);
    const data = await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const old = await repository.lockChallenge(oldHash);
      const registrationSubject = input.pendingRegistrationId && old?.purpose === "REGISTRATION_EMAIL_VERIFY" &&
        (old.pendingRegistrationId ?? old.resourceId) === input.pendingRegistrationId;
      const customerSubject = input.customerId && old?.customerId === input.customerId;
      if (
        !old ||
        old.deviceId !== input.deviceId ||
        old.method !== "EMAIL_OTP" ||
        old.status !== "ACTIVE" ||
        (!registrationSubject && !customerSubject)
      ) {
        throw notFound("MFA challenge not found.");
      }
      const lastSent = old.lastSentAt ? Date.parse(old.lastSentAt) : 0;
      if (lastSent && lastSent + RESEND_COOLDOWN_MS > this.clock()) {
        this.metrics.increment("auth_challenges_rate_limited_total");
        throw rateLimited(
          "Please wait before requesting another code.",
          Math.ceil((lastSent + RESEND_COOLDOWN_MS - this.clock()) / 1000),
        );
      }
      const rateSubject = input.customerId ?? input.pendingRegistrationId!;
      const customerRate = await repository.atomicRateLimit({
        bucketKey: `mfa-resend:customer:${rateSubject}`,
        windowSeconds: 600,
        maxAttempts: 3,
      });
      if (!customerRate.allowed) {
        this.metrics.increment("auth_challenges_rate_limited_total");
        throw rateLimited("Too many MFA resend requests.", customerRate.retryAfterSeconds);
      }
      const challengeId = createOpaqueToken();
      const challengeHash = hashOpaqueToken(challengeId);
      const code = this.codeGenerator.generate();
      const expiresAt = new Date(this.clock() + EMAIL_CHALLENGE_TTL_MS).toISOString();
      await repository.cancelChallenge(oldHash);
      await repository.createChallenge({
        id: challengeHash,
        customerId: old.customerId,
        pendingRegistrationId: old.pendingRegistrationId ?? input.pendingRegistrationId,
        deviceId: input.deviceId,
        method: "EMAIL_OTP",
        purpose: old.purpose as MfaChallengePurpose,
        resourceId: old.resourceId,
        requestFingerprint: old.requestFingerprint,
        proofDigest: this.options.otpDigestKeyring.digest(challengeHash, code),
        digestKeyId: this.options.otpDigestKeyring.currentKeyId,
        expiresAt,
        status: "PENDING_DELIVERY",
        resendCount: old.resendCount + 1,
        lastSentAt: new Date(this.clock()).toISOString(),
        createdDeviceFingerprint: fingerprint(input.deviceId),
        createdIpFingerprint: input.networkFingerprint ? fingerprint(input.networkFingerprint) : null,
      });
      return { challengeId, challengeHash, code, purpose: old.purpose as MfaChallengePurpose, expiresAt };
    });
    const deliveryResult: DeliveryResult = await this.delivery.send({
      deliveryId: data.challengeHash,
      purpose: data.purpose,
      destination: input.destination,
      code: data.code,
      expiresAt: data.expiresAt,
    });
    await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      if (deliveryResult.status === "SENT") {
        await client.query(`UPDATE auth_challenges SET status = 'ACTIVE', updated_at = NOW() WHERE id = $1`, [data.challengeHash]);
      } else {
        await repository.markChallengeDeliveryFailed(data.challengeHash);
      }
    });
    if (deliveryResult.status === "FAILED") {
      this.metrics.increment("auth_delivery_failure_total");
      throw conflictWithCode("OTP_DELIVERY_FAILED", "Không thể gửi mã xác nhận.");
    }
    this.metrics.increment("auth_delivery_success_total");
    this.metrics.increment("auth_challenges_created_total");
    return {
      challengeId: data.challengeId,
      method: "EMAIL_OTP",
      methods: ["EMAIL_OTP"],
      purpose: data.purpose,
      expiresAt: data.expiresAt,
      resendAfter: new Date(this.clock() + RESEND_COOLDOWN_MS).toISOString(),
      maskedDestination: maskEmail(input.destination),
    };
  }

  /** Resend a registration OTP before a customer session exists. */
  async resendRegistrationChallenge(input: {
    challengeId: string;
    deviceId: string;
    networkFingerprint?: string | null;
  }): Promise<MfaChallengeResponse> {
    const target = await this.options.unitOfWork.transaction(async ({ client }) => {
      const challenge = await new MfaRepository(client).lockChallenge(hashOpaqueToken(input.challengeId));
      if (
        !challenge ||
        challenge.deviceId !== input.deviceId ||
        challenge.method !== "EMAIL_OTP" ||
        challenge.purpose !== "REGISTRATION_EMAIL_VERIFY" ||
        challenge.status !== "ACTIVE"
      ) {
        throw notFound("Registration challenge not found.");
      }
      const pendingRegistrationId = challenge.pendingRegistrationId ?? challenge.resourceId;
      if (!pendingRegistrationId) throw notFound("Registration challenge not found.");
      const result = await client.query<{ email?: string }>(
        "SELECT email FROM pending_registrations WHERE id = $1",
        [pendingRegistrationId],
      );
      const destination = String(result.rows[0]?.email ?? "").trim();
      if (!destination) throw notFound("Registration challenge not found.");
      return { pendingRegistrationId, destination };
    });
    return this.resendChallenge({
      challengeId: input.challengeId,
      pendingRegistrationId: target.pendingRegistrationId,
      deviceId: input.deviceId,
      destination: target.destination,
      networkFingerprint: input.networkFingerprint,
    });
  }

  async verifyRecoveryCode(customerId: string, code: string): Promise<{
    recoveryRequestId: string;
    recoveryToken: string;
    status: "PRIMARY_PROOF_VERIFIED";
    cooldownUntil: string;
  }> {
    if (typeof code !== "string" || code.length < 16) {
      throw unauthorized("Recovery code is invalid.");
    }
    const recoveryToken = createOpaqueToken();
    const recoveryRequestId = createId("mfa-recovery-request");
    const now = this.clock();
    const cooldownMs = Number(process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS ?? DEFAULT_RECOVERY_COOLDOWN_MS);
    const cooldownDuration = Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : DEFAULT_RECOVERY_COOLDOWN_MS;
    const cooldownUntil = new Date(now + cooldownDuration);
    const expiresAt = new Date(cooldownUntil.getTime() + RECOVERY_REQUEST_TTL_MS);
    const success = await this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const candidates = await repository.lockActiveRecoveryCodes(customerId);
      for (const candidate of candidates) {
        const salt = Buffer.from(String(candidate.salt), "hex");
        const digest = digestRecoveryCode(code, salt);
        const expected = Buffer.from(String(candidate.code_digest), "hex");
        const actual = Buffer.from(digest, "hex");
        if (expected.length === actual.length && timingSafeEqual(actual, expected) && await repository.consumeRecoveryCode(String(candidate.id))) {
          // A successful recovery proof invalidates every remaining recovery
          // code immediately so a stolen unused code cannot survive the
          // recovery transition.
          await repository.revokeCustomerRecoveryCodes(customerId);
          await repository.createRecoveryRequest({
            id: recoveryRequestId,
            customerId,
            publicTokenHash: hashOpaqueToken(recoveryToken),
            expiresAt: expiresAt.toISOString(),
            cooldownUntil: cooldownUntil.toISOString(),
          });
          await repository.insertSecurityEvent({
            id: createId("auth-security-event"),
            customerId,
            eventType: "MFA_RECOVERY_STARTED",
            purpose: "MFA_RECOVERY",
          });
          return true;
        }
      }
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId,
        eventType: "MFA_VERIFY_FAILED",
        purpose: "MFA_RECOVERY",
      });
      return false;
    });
    if (!success) {
      this.metrics.increment("auth_challenges_failed_total");
      this.metrics.increment("auth_suspicious_events_total");
      throw unauthorized("Recovery code is invalid or already used.");
    }
    this.metrics.increment("mfa_recovery_started_total");
    return {
      recoveryRequestId,
      recoveryToken,
      status: "PRIMARY_PROOF_VERIFIED",
      cooldownUntil: cooldownUntil.toISOString(),
    };
  }

  async completeRecovery(input: {
    customerId?: string;
    recoveryToken: string;
  }): Promise<{ customerId: string }> {
    const tokenHash = hashOpaqueToken(input.recoveryToken);
    return this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      const request = await repository.lockRecoveryRequest(tokenHash);
      const customerId = request ? String(request.customer_id) : null;
      if (!request || (input.customerId !== undefined && customerId !== input.customerId)) {
        throw unauthorized("MFA recovery request is invalid or expired.");
      }
      const expiresAt = new Date(String(request.expires_at)).getTime();
      const cooldownUntil = new Date(String(request.cooldown_until ?? 0)).getTime();
      if (expiresAt <= this.clock()) {
        throw unauthorized("MFA recovery request is invalid or expired.");
      }
      if (cooldownUntil > this.clock()) {
        throw conflictWithCode("MFA_RECOVERY_COOLDOWN", "MFA recovery is still in its cooldown period.");
      }
      await repository.revokeAllTotpCredentials(customerId!, "recovery");
      if (!(await repository.completeRecoveryRequest(String(request.id)))) {
        throw conflictWithCode("MFA_RECOVERY_ALREADY_COMPLETED", "MFA recovery request has already been completed.");
      }
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId: customerId!,
        eventType: "MFA_RECOVERY_COMPLETED",
        purpose: "MFA_RECOVERY",
      });
      this.metrics.increment("mfa_recovery_completed_total");
      return { customerId: customerId! };
    });
  }

  async rotateRecoveryCodes(customerId: string): Promise<string[]> {
    return this.options.unitOfWork.transaction(async ({ client }) => {
      const repository = new MfaRepository(client);
      await repository.revokeCustomerRecoveryCodes(customerId);
      const recoveryCodes: string[] = [];
      for (let index = 0; index < RECOVERY_CODE_COUNT; index += 1) {
        const generated = generateRecoveryCode();
        recoveryCodes.push(generated.plaintext);
        await repository.createRecoveryCode({
          id: createId("mfa-recovery-code"),
          customerId,
          codeDigest: generated.digest,
          salt: generated.salt.toString("hex"),
        });
      }
      await repository.insertSecurityEvent({
        id: createId("auth-security-event"),
        customerId,
        eventType: "MFA_RECOVERY_CODES_ROTATED",
        purpose: "RECOVERY_CODE_ROTATION",
        metadata: { recoveryCodeCount: recoveryCodes.length },
      });
      return recoveryCodes;
    });
  }
}
