import type { PoolClient } from "pg";

import { requireUuid } from "../rowMappers.js";

export type MfaCredentialStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";
export type MfaChallengeStatus =
  | "PENDING_DELIVERY"
  | "ACTIVE"
  | "VERIFIED"
  | "CONSUMED"
  | "EXPIRED"
  | "LOCKED"
  | "CANCELLED"
  | "DELIVERY_FAILED";

export type MfaRecoveryRequestStatus =
  | "REQUESTED"
  | "PRIMARY_PROOF_VERIFIED"
  | "PENDING_REVIEW"
  | "COOLDOWN"
  | "APPROVED"
  | "COMPLETED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type MfaCredentialRow = {
  id: string;
  customerId: string;
  credentialType: "TOTP" | "BIOMETRIC" | "PASSKEY" | "OOB_SMS";
  deviceId: string | null;
  displayName: string;
  status: MfaCredentialStatus;
  secretCiphertext: string | null;
  secretKeyId: string | null;
  secretCipherVersion: string | null;
  secretAadVersion: string | null;
  secretEncryptionAlgorithm: string | null;
  secretEncryptedDataKey: string | null;
  algorithm: string;
  digits: number;
  periodSeconds: number;
  lastAcceptedTimeStep: number | null;
  enrolledAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  compromisedAt: string | null;
  createdAt: string;
};

export type MfaChallengeRow = Record<string, unknown> & {
  id: string;
  customerId: string | null;
  pendingRegistrationId: string | null;
  credentialId: string | null;
  deviceId: string;
  method: string | null;
  purpose: string;
  resourceId: string | null;
  requestFingerprint: string | null;
  status: MfaChallengeStatus;
  proofDigest: string | null;
  digestKeyId: string | null;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  resendCount: number;
  lastSentAt: string | null;
};

function mapCredential(row: Record<string, unknown>): MfaCredentialRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    credentialType: String(row.credential_type) as MfaCredentialRow["credentialType"],
    deviceId: row.device_id === null || row.device_id === undefined ? null : String(row.device_id),
    displayName: String(row.display_name),
    status: String(row.status) as MfaCredentialStatus,
    secretCiphertext: row.secret_ciphertext === null ? null : String(row.secret_ciphertext),
    secretKeyId: row.secret_key_id === null ? null : String(row.secret_key_id),
    secretCipherVersion: row.secret_cipher_version === null || row.secret_cipher_version === undefined ? null : String(row.secret_cipher_version),
    secretAadVersion: row.secret_aad_version === null || row.secret_aad_version === undefined ? null : String(row.secret_aad_version),
    secretEncryptionAlgorithm: row.secret_encryption_algorithm === null || row.secret_encryption_algorithm === undefined ? null : String(row.secret_encryption_algorithm),
    secretEncryptedDataKey: row.secret_encrypted_data_key === null || row.secret_encrypted_data_key === undefined ? null : String(row.secret_encrypted_data_key),
    algorithm: String(row.algorithm),
    digits: Number(row.digits),
    periodSeconds: Number(row.period_seconds),
    lastAcceptedTimeStep: row.last_accepted_time_step === null ? null : Number(row.last_accepted_time_step),
    enrolledAt: row.enrolled_at ? new Date(String(row.enrolled_at)).toISOString() : null,
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    compromisedAt: row.compromised_at ? new Date(String(row.compromised_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapChallenge(row: Record<string, unknown>): MfaChallengeRow {
  return {
    ...row,
    id: String(row.id),
    customerId: row.customer_id === null ? null : String(row.customer_id),
    pendingRegistrationId: row.pending_registration_id === null ? null : String(row.pending_registration_id),
    credentialId: row.credential_id === null ? null : String(row.credential_id),
    deviceId: String(row.device_id),
    method: row.method === null ? null : String(row.method),
    purpose: String(row.purpose),
    resourceId: row.resource_id === null ? null : String(row.resource_id),
    requestFingerprint: row.request_fingerprint === null ? null : String(row.request_fingerprint),
    status: String(row.status) as MfaChallengeStatus,
    proofDigest: row.proof_digest === null ? null : String(row.proof_digest),
    digestKeyId: row.digest_key_id === null ? null : String(row.digest_key_id),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    resendCount: Number(row.resend_count),
    lastSentAt: row.last_sent_at ? new Date(String(row.last_sent_at)).toISOString() : null,
  };
}

export class MfaRepository {
  constructor(private readonly client: PoolClient) {}

  async listCredentials(customerId: string): Promise<MfaCredentialRow[]> {
    const result = await this.client.query(
      `SELECT * FROM mfa_credentials WHERE customer_id = $1 ORDER BY created_at ASC`,
      [requireUuid(customerId, "customerId")],
    );
    return result.rows.map((row) => mapCredential(row as Record<string, unknown>));
  }

  async lockCredential(credentialId: string): Promise<MfaCredentialRow | null> {
    const result = await this.client.query(
      `SELECT * FROM mfa_credentials WHERE id = $1 FOR UPDATE`,
      [requireUuid(credentialId, "credentialId")],
    );
    return result.rows[0] ? mapCredential(result.rows[0] as Record<string, unknown>) : null;
  }

  async findActiveTotp(customerId: string): Promise<MfaCredentialRow | null> {
    const result = await this.client.query(
      `SELECT * FROM mfa_credentials
       WHERE customer_id = $1 AND credential_type = 'TOTP' AND status = 'ACTIVE'
       ORDER BY created_at ASC LIMIT 1`,
      [requireUuid(customerId, "customerId")],
    );
    return result.rows[0] ? mapCredential(result.rows[0] as Record<string, unknown>) : null;
  }

  async findActiveBiometric(customerId: string, deviceId: string): Promise<MfaCredentialRow | null> {
    const result = await this.client.query(
      `SELECT * FROM mfa_credentials
       WHERE customer_id = $1
         AND credential_type = 'BIOMETRIC'
         AND status = 'ACTIVE'
         AND (device_id = $2 OR device_id IS NULL)
       ORDER BY created_at DESC LIMIT 1`,
      [requireUuid(customerId, "customerId"), deviceId],
    );
    return result.rows[0] ? mapCredential(result.rows[0] as Record<string, unknown>) : null;
  }

  async revokeActiveBiometricByDevice(customerId: string, deviceId: string): Promise<void> {
    await this.client.query(
      `UPDATE mfa_credentials
       SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
       WHERE customer_id = $1
         AND credential_type = 'BIOMETRIC'
         AND status <> 'REVOKED'
         AND (device_id = $2 OR device_id IS NULL)`,
      [requireUuid(customerId, "customerId"), deviceId],
    );
  }

  async createBiometricCredential(input: {
    id: string;
    customerId: string;
    deviceId: string;
    displayName: string;
    secretCiphertext: string;
    secretKeyId: string;
    secretCipherVersion?: string;
    secretAadVersion?: string | null;
    secretEncryptionAlgorithm?: string;
    secretEncryptedDataKey?: string | null;
  }): Promise<MfaCredentialRow> {
    const result = await this.client.query(
      `INSERT INTO mfa_credentials
        (id, customer_id, credential_type, device_id, display_name, status,
         secret_ciphertext, secret_key_id, secret_cipher_version,
         secret_aad_version, secret_encryption_algorithm, secret_encrypted_data_key,
         algorithm, digits, period_seconds, enrolled_at)
       VALUES ($1, $2, 'BIOMETRIC', $3, $4, 'ACTIVE', $5, $6, $7, $8, $9, $10, 'HMAC-SHA256', 6, 30, NOW())
       RETURNING *`,
      [
        requireUuid(input.id),
        requireUuid(input.customerId, "customerId"),
        input.deviceId,
        input.displayName,
        input.secretCiphertext,
        input.secretKeyId,
        input.secretCipherVersion ?? "v2",
        input.secretAadVersion ?? "aad-v1",
        input.secretEncryptionAlgorithm ?? "AES-256-GCM-ENVELOPE",
        input.secretEncryptedDataKey ?? null,
      ],
    );
    return mapCredential(result.rows[0] as Record<string, unknown>);
  }

  async touchCredentialUsed(credentialId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE mfa_credentials
       SET last_used_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'ACTIVE'`,
      [requireUuid(credentialId, "credentialId")],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async createTotpCredential(input: {
    id: string;
    customerId: string;
    displayName: string;
    secretCiphertext: string;
    secretKeyId: string;
    secretCipherVersion?: string;
    secretAadVersion?: string | null;
    secretEncryptionAlgorithm?: string;
    secretEncryptedDataKey?: string | null;
  }): Promise<MfaCredentialRow> {
    const result = await this.client.query(
      `INSERT INTO mfa_credentials
        (id, customer_id, credential_type, display_name, status,
         secret_ciphertext, secret_key_id, secret_cipher_version,
         secret_aad_version, secret_encryption_algorithm, secret_encrypted_data_key,
         algorithm, digits, period_seconds)
       VALUES ($1, $2, 'TOTP', $3, 'PENDING', $4, $5, $6, $7, $8, $9, 'SHA1', 6, 30)
       RETURNING *`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.displayName, input.secretCiphertext, input.secretKeyId, input.secretCipherVersion ?? "v2", input.secretAadVersion ?? "aad-v1", input.secretEncryptionAlgorithm ?? "AES-256-GCM-ENVELOPE", input.secretEncryptedDataKey ?? null],
    );
    return mapCredential(result.rows[0] as Record<string, unknown>);
  }

  async activateCredential(credentialId: string, timeStep: number): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE mfa_credentials
       SET status = 'ACTIVE', enrolled_at = COALESCE(enrolled_at, NOW()),
           last_used_at = NOW(), last_accepted_time_step = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id`,
      [requireUuid(credentialId, "credentialId"), timeStep],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async acceptTotpStep(credentialId: string, timeStep: number): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE mfa_credentials
       SET last_accepted_time_step = $2, last_used_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'ACTIVE'
         AND (last_accepted_time_step IS NULL OR last_accepted_time_step < $2)
       RETURNING id`,
      [requireUuid(credentialId, "credentialId"), timeStep],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async revokeCredential(credentialId: string, reason?: string): Promise<boolean> {
    void reason;
    const result = await this.client.query(
      `UPDATE mfa_credentials
       SET status = 'REVOKED', revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status <> 'REVOKED'`,
      [requireUuid(credentialId, "credentialId")],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async revokeCustomerRecoveryCodes(customerId: string): Promise<void> {
    await this.client.query(
      `UPDATE mfa_recovery_codes
       SET status = 'REVOKED', revoked_at = NOW()
       WHERE customer_id = $1 AND status = 'ACTIVE'`,
      [requireUuid(customerId, "customerId")],
    );
  }

  async createRecoveryCode(input: {
    id: string;
    customerId: string;
    codeDigest: string;
    salt: string;
    digestKeyId?: string | null;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO mfa_recovery_codes (id, customer_id, code_digest, salt, digest_key_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.codeDigest, input.salt, input.digestKeyId ?? null],
    );
  }

  async lockActiveRecoveryCodes(customerId: string): Promise<Record<string, unknown>[]> {
    const result = await this.client.query(
      `SELECT * FROM mfa_recovery_codes
       WHERE customer_id = $1 AND status = 'ACTIVE'
       ORDER BY created_at ASC
       FOR UPDATE`,
      [requireUuid(customerId, "customerId")],
    );
    return result.rows as Record<string, unknown>[];
  }

  async consumeRecoveryCode(codeId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE mfa_recovery_codes
       SET status = 'USED', used_at = NOW()
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING id`,
      [requireUuid(codeId, "codeId")],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async createRecoveryRequest(input: {
    id: string;
    customerId: string;
    publicTokenHash: string;
    expiresAt: string;
    cooldownUntil: string;
    status?: MfaRecoveryRequestStatus;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO mfa_recovery_requests
        (id, customer_id, public_token_hash, status, requested_method,
         risk_level, expires_at, verified_at, cooldown_until)
       VALUES ($1, $2, $3, $4, 'RECOVERY_CODE', 'MEDIUM', $5, NOW(), $6)`,
      [
        requireUuid(input.id),
        requireUuid(input.customerId, "customerId"),
        input.publicTokenHash,
        input.status ?? "PRIMARY_PROOF_VERIFIED",
        input.expiresAt,
        input.cooldownUntil,
      ],
    );
  }

  async lockRecoveryRequest(publicTokenHash: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      `SELECT * FROM mfa_recovery_requests
       WHERE public_token_hash = $1
       FOR UPDATE`,
      [publicTokenHash],
    );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async completeRecoveryRequest(id: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE mfa_recovery_requests
       SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status IN ('PRIMARY_PROOF_VERIFIED', 'APPROVED')
       RETURNING id`,
      [requireUuid(id, "recoveryRequestId")],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async revokeOtherTotpCredentials(customerId: string, keepCredentialId: string): Promise<void> {
    await this.client.query(
      `UPDATE mfa_credentials
       SET status = 'REVOKED', revoked_at = NOW(), compromised_at = NOW(), updated_at = NOW()
       WHERE customer_id = $1 AND credential_type = 'TOTP'
         AND id <> $2 AND status <> 'REVOKED'`,
      [requireUuid(customerId, "customerId"), requireUuid(keepCredentialId, "credentialId")],
    );
  }

  async revokeAllTotpCredentials(customerId: string, reason = "recovery"): Promise<number> {
    void reason;
    const result = await this.client.query(
      `UPDATE mfa_credentials
       SET status = 'REVOKED', revoked_at = NOW(), compromised_at = NOW(), updated_at = NOW()
       WHERE customer_id = $1 AND credential_type = 'TOTP' AND status <> 'REVOKED'`,
      [requireUuid(customerId, "customerId")],
    );
    return result.rowCount ?? 0;
  }

  async createChallenge(input: {
    id: string;
    customerId?: string | null;
    pendingRegistrationId?: string | null;
    credentialId?: string | null;
    deviceId: string;
    method: "EMAIL_OTP" | "SMS_OTP" | "TOTP" | "BIOMETRIC";
    purpose: string;
    resourceId?: string | null;
    requestFingerprint?: string | null;
    proofDigest?: string | null;
    digestKeyId?: string | null;
    expiresAt: string;
    maxAttempts?: number;
    resendCount?: number;
    lastSentAt?: string | null;
    status?: MfaChallengeStatus;
    createdIpFingerprint?: string | null;
    createdDeviceFingerprint?: string | null;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO auth_challenges
        (id, customer_id, pending_registration_id, credential_id, device_id,
         method, purpose, resource_id, request_fingerprint, methods,
         otp_hash, proof_digest, digest_key_id, status, expires_at,
         attempts, max_attempts, resend_count, last_sent_at,
         created_ip_fingerprint, created_device_fingerprint, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               ARRAY[$6]::text[], $10, $10, $11, $12, $13,
               0, $14, $15, $16, $17, $18, NOW())`,
      [
        input.id,
        input.customerId ? requireUuid(input.customerId, "customerId") : null,
        input.pendingRegistrationId ?? null,
        input.credentialId ? requireUuid(input.credentialId, "credentialId") : null,
        input.deviceId,
        input.method,
        input.purpose,
        input.resourceId ?? null,
        input.requestFingerprint ?? null,
        input.proofDigest ?? null,
        input.digestKeyId ?? null,
        input.status ?? "ACTIVE",
        input.expiresAt,
        input.maxAttempts ?? 5,
        input.resendCount ?? 0,
        input.lastSentAt ?? null,
        input.createdIpFingerprint ?? null,
        input.createdDeviceFingerprint ?? null,
      ],
    );
  }

  async lockChallenge(challengeId: string): Promise<MfaChallengeRow | null> {
    const result = await this.client.query(
      `SELECT * FROM auth_challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    return result.rows[0] ? mapChallenge(result.rows[0] as Record<string, unknown>) : null;
  }

  async recordChallengeFailure(challengeId: string): Promise<{ attempts: number; locked: boolean }> {
    const result = await this.client.query(
      `UPDATE auth_challenges
       SET attempts = attempts + 1,
           status = CASE WHEN attempts + 1 >= max_attempts THEN 'LOCKED' ELSE status END,
           locked_at = CASE WHEN attempts + 1 >= max_attempts THEN NOW() ELSE locked_at END,
           updated_at = NOW()
       WHERE id = $1 AND status IN ('PENDING_DELIVERY', 'ACTIVE', 'VERIFIED')
       RETURNING attempts, status`,
      [challengeId],
    );
    const row = result.rows[0] as { attempts?: number; status?: string } | undefined;
    return { attempts: Number(row?.attempts ?? 0), locked: row?.status === "LOCKED" };
  }

  async markChallengeDeliveryFailed(challengeId: string): Promise<void> {
    await this.client.query(
      `UPDATE auth_challenges SET status = 'DELIVERY_FAILED', updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING_DELIVERY'`,
      [challengeId],
    );
  }

  async expireChallenge(challengeId: string): Promise<void> {
    await this.client.query(
      `UPDATE auth_challenges SET status = 'EXPIRED', updated_at = NOW()
       WHERE id = $1 AND status IN ('PENDING_DELIVERY', 'ACTIVE', 'VERIFIED')`,
      [challengeId],
    );
  }

  async consumeChallenge(challengeId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE auth_challenges
       SET status = 'CONSUMED', consumed_at = NOW(), verified_at = COALESCE(verified_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND status IN ('ACTIVE', 'VERIFIED') AND expires_at > NOW()
       RETURNING id`,
      [challengeId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async cancelChallenge(challengeId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE auth_challenges SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status IN ('PENDING_DELIVERY', 'ACTIVE', 'VERIFIED')`,
      [challengeId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async cancelActiveChallenges(input: {
    customerId: string;
    deviceId: string;
    purpose: string;
    resourceId?: string | null;
    requestFingerprint?: string | null;
  }): Promise<number> {
    const result = await this.client.query(
      `UPDATE auth_challenges
       SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
       WHERE customer_id = $1
         AND device_id = $2
         AND purpose = $3
         AND resource_id IS NOT DISTINCT FROM $4
         AND request_fingerprint IS NOT DISTINCT FROM $5
         AND status IN ('PENDING_DELIVERY', 'ACTIVE', 'VERIFIED')`,
      [
        requireUuid(input.customerId, "customerId"),
        input.deviceId,
        input.purpose,
        input.resourceId ?? null,
        input.requestFingerprint ?? null,
      ],
    );
    return result.rowCount ?? 0;
  }

  async cancelChallengesByPendingRegistration(pendingRegistrationId: string): Promise<void> {
    await this.client.query(
      `UPDATE auth_challenges
       SET status = 'CANCELLED',
           cancelled_at = NOW(),
           pending_registration_id = NULL,
           updated_at = NOW()
       WHERE pending_registration_id = $1
         AND status IN ('PENDING_DELIVERY', 'ACTIVE')`,
      [pendingRegistrationId]
    );

    await this.client.query(
      `UPDATE auth_challenges
       SET pending_registration_id = NULL,
           updated_at = NOW()
       WHERE pending_registration_id = $1
         AND status IN ('VERIFIED', 'CONSUMED', 'EXPIRED', 'LOCKED', 'CANCELLED', 'DELIVERY_FAILED')`,
      [pendingRegistrationId]
    );
  }

  async atomicRateLimit(input: {
    bucketKey: string;
    windowSeconds: number;
    maxAttempts: number;
    now?: Date;
  }): Promise<{ allowed: boolean; attempts: number; retryAfterSeconds: number }> {
    const now = input.now ?? new Date();
    const result = await this.client.query(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempts, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (bucket_key) DO UPDATE SET
         window_started_at = CASE
           WHEN rate_limit_buckets.window_started_at <= $2::timestamptz - ($3::text || ' seconds')::interval
             THEN $2::timestamptz
           ELSE rate_limit_buckets.window_started_at
         END,
         attempts = CASE
           WHEN rate_limit_buckets.window_started_at <= $2::timestamptz - ($3::text || ' seconds')::interval
             THEN 1
           ELSE rate_limit_buckets.attempts + 1
         END,
         updated_at = NOW()
       RETURNING attempts, EXTRACT(EPOCH FROM (($2::timestamptz + ($3::text || ' seconds')::interval) - NOW()))::int AS retry_after`,
      [input.bucketKey, now.toISOString(), input.windowSeconds],
    );
    const row = result.rows[0] as { attempts?: number; retry_after?: number };
    const attempts = Number(row.attempts ?? 0);
    return {
      allowed: attempts <= input.maxAttempts,
      attempts,
      retryAfterSeconds: Math.max(1, Number(row.retry_after ?? input.windowSeconds)),
    };
  }

  async insertSecurityEvent(input: {
    id: string;
    customerId?: string | null;
    eventType: string;
    purpose?: string | null;
    deviceFingerprint?: string | null;
    networkFingerprint?: string | null;
    riskScore?: number | null;
    riskDecision?: string | null;
    challengeId?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO auth_security_events
        (id, customer_id, event_type, purpose, device_fingerprint,
         network_fingerprint, risk_score, risk_decision, challenge_id,
         resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        requireUuid(input.id),
        input.customerId ? requireUuid(input.customerId, "customerId") : null,
        input.eventType,
        input.purpose ?? null,
        input.deviceFingerprint ?? null,
        input.networkFingerprint ?? null,
        input.riskScore ?? null,
        input.riskDecision ?? null,
        input.challengeId ?? null,
        input.resourceId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}
