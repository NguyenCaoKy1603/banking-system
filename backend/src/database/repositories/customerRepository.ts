import type { PoolClient } from "pg";

import { asIso, asNullableIso, asString, requireUuid } from "../rowMappers.js";

export type CustomerRow = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  passwordSalt: string;
  passwordDigest: string;
  createdAt: string;
};

export type CustomerCreateInput = Omit<CustomerRow, "createdAt"> & { createdAt?: string };

export type DeviceRow = {
  id: string;
  customerId: string;
  deviceId: string;
  attestationStatus: "PENDING" | "VERIFIED" | "REVOKED";
  createdAt: string;
  revokedAt: string | null;
};

export type SessionCreateInput = {
  id: string;
  customerId: string;
  deviceRecordId: string;
  familyId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  expiresAt: string;
  createdAt?: string;
};

export type AuthChallengeCreateInput = {
  id: string;
  customerId?: string | null;
  pendingRegistrationId?: string | null;
  credentialId?: string | null;
  deviceId: string;
  method?: "EMAIL_OTP" | "SMS_OTP" | "TOTP";
  purpose: string;
  resourceId?: string | null;
  requestFingerprint?: string | null;
  methods?: readonly string[];
  otpHash?: string | null;
  proofDigest?: string | null;
  digestKeyId?: string | null;
  expiresAt: string;
  maxAttempts?: number;
  resendCount?: number;
  lastSentAt?: string | null;
};

function mapCustomer(row: Record<string, unknown>): CustomerRow {
  return {
    id: requireUuid(row.id),
    fullName: asString(row.full_name),
    email: asString(row.email),
    phoneNumber: asString(row.phone_number),
    passwordSalt: asString(row.password_salt),
    passwordDigest: asString(row.password_digest),
    createdAt: asIso(row.created_at, "created_at"),
  };
}

function mapDevice(row: Record<string, unknown>): DeviceRow {
  return {
    id: requireUuid(row.id),
    customerId: requireUuid(row.customer_id, "customer_id"),
    deviceId: asString(row.device_id),
    attestationStatus: asString(row.attestation_status) as DeviceRow["attestationStatus"],
    createdAt: asIso(row.created_at, "created_at"),
    revokedAt: asNullableIso(row.revoked_at, "revoked_at"),
  };
}

export class CustomerRepository {
  constructor(private readonly client: PoolClient) {}

  async createCustomer(input: CustomerCreateInput): Promise<CustomerRow> {
    const result = await this.client.query(
      `
        INSERT INTO customers
          (id, full_name, email, phone_number, password_salt, password_digest, created_at)
        VALUES ($1, $2, lower($3), $4, $5, $6, COALESCE($7::timestamptz, NOW()))
        RETURNING *
      `,
      [
        requireUuid(input.id),
        input.fullName,
        input.email,
        input.phoneNumber,
        input.passwordSalt,
        input.passwordDigest,
        input.createdAt ?? null,
      ],
    );
    return mapCustomer(result.rows[0] as Record<string, unknown>);
  }

  async findCustomerById(customerId: string): Promise<CustomerRow | null> {
    const result = await this.client.query("SELECT * FROM customers WHERE id = $1", [
      requireUuid(customerId, "customerId"),
    ]);
    return result.rows[0] ? mapCustomer(result.rows[0] as Record<string, unknown>) : null;
  }

  async findCustomerByEmail(email: string): Promise<CustomerRow | null> {
    const result = await this.client.query("SELECT * FROM customers WHERE lower(email) = lower($1)", [email]);
    return result.rows[0] ? mapCustomer(result.rows[0] as Record<string, unknown>) : null;
  }

  async findCustomerByPhone(phoneNumber: string): Promise<CustomerRow | null> {
    const result = await this.client.query("SELECT * FROM customers WHERE phone_number = $1", [phoneNumber]);
    return result.rows[0] ? mapCustomer(result.rows[0] as Record<string, unknown>) : null;
  }

  async createDevice(input: {
    id: string;
    customerId: string;
    deviceId: string;
    attestationStatus?: DeviceRow["attestationStatus"];
  }): Promise<DeviceRow> {
    const result = await this.client.query(
      `
        INSERT INTO customer_devices (id, customer_id, device_id, attestation_status, created_at)
        VALUES ($1, $2, $3, COALESCE($4, 'PENDING'), NOW())
        ON CONFLICT (customer_id, device_id)
        DO UPDATE SET revoked_at = NULL
        RETURNING *
      `,
      [requireUuid(input.id), requireUuid(input.customerId, "customerId"), input.deviceId, input.attestationStatus ?? null],
    );
    return mapDevice(result.rows[0] as Record<string, unknown>);
  }

  async createSession(input: SessionCreateInput): Promise<void> {
    await this.client.query(
      `
        INSERT INTO auth_sessions
          (id, customer_id, device_id, family_id, access_token_hash,
           refresh_token_hash, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()))
      `,
      [
        requireUuid(input.id),
        requireUuid(input.customerId, "customerId"),
        requireUuid(input.deviceRecordId, "deviceRecordId"),
        requireUuid(input.familyId, "familyId"),
        input.accessTokenHash,
        input.refreshTokenHash,
        input.expiresAt,
        input.createdAt ?? null,
      ],
    );
  }

  async revokeSessionFamily(familyId: string): Promise<number> {
    const result = await this.client.query(
      "UPDATE auth_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL",
      [requireUuid(familyId, "familyId")],
    );
    return result.rowCount ?? 0;
  }

  async ensureRefreshSessionFamily(familyId: string, customerId: string): Promise<void> {
    await this.client.query(
      `INSERT INTO refresh_session_families (family_id, customer_id)
       VALUES ($1, $2)
       ON CONFLICT (family_id) DO UPDATE SET customer_id = EXCLUDED.customer_id`,
      [requireUuid(familyId, "familyId"), requireUuid(customerId, "customerId")],
    );
  }

  async upsertRefreshSession(input: {
    sessionKey: string;
    customerId: string;
    familyId: string;
    deviceId: string;
    expiresAt: string;
    revoked?: boolean;
  }): Promise<void> {
    await this.ensureRefreshSessionFamily(input.familyId, input.customerId);
    await this.client.query(
      `INSERT INTO refresh_session_records
        (session_key, customer_id, family_id, device_id, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN NOW() ELSE NULL END)
       ON CONFLICT (session_key) DO UPDATE SET
         expires_at = EXCLUDED.expires_at,
         revoked_at = EXCLUDED.revoked_at`,
      [input.sessionKey, requireUuid(input.customerId, "customerId"), requireUuid(input.familyId, "familyId"), input.deviceId, input.expiresAt, input.revoked ?? false],
    );
  }

  async revokeRefreshFamily(familyId: string): Promise<number> {
    const result = await this.client.query(
      `UPDATE refresh_session_families SET revoked_at = NOW()
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [requireUuid(familyId, "familyId")],
    );
    await this.client.query(
      `UPDATE refresh_session_records SET revoked_at = NOW()
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [requireUuid(familyId, "familyId")],
    );
    return result.rowCount ?? 0;
  }

  async createAuthChallenge(input: AuthChallengeCreateInput): Promise<void> {
    await this.client.query(
      `INSERT INTO auth_challenges
        (id, customer_id, pending_registration_id, credential_id, device_id,
         method, purpose, resource_id, request_fingerprint, methods,
         otp_hash, proof_digest, digest_key_id, expires_at, max_attempts,
         resend_count, last_sent_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[],
               $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        input.id,
        input.customerId ? requireUuid(input.customerId, "customerId") : null,
        input.pendingRegistrationId ?? null,
        input.credentialId ? requireUuid(input.credentialId, "credentialId") : null,
        input.deviceId,
        input.method ?? (input.methods?.includes("TOTP") ? "TOTP" : "EMAIL_OTP"),
        input.purpose,
        input.resourceId ?? null,
        input.requestFingerprint ?? null,
        input.methods ?? ["OTP"],
        input.otpHash ?? input.proofDigest ?? null,
        input.proofDigest ?? input.otpHash ?? null,
        input.digestKeyId ?? null,
        input.expiresAt,
        input.maxAttempts ?? 5,
        input.resendCount ?? 0,
        input.lastSentAt ?? null,
        "ACTIVE",
      ],
    );
  }

  async lockAuthChallenge(challengeId: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      "SELECT * FROM auth_challenges WHERE id = $1 FOR UPDATE",
      [challengeId],
    );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async consumeAuthChallenge(challengeId: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE auth_challenges
       SET consumed_at = NOW(), verified_at = COALESCE(verified_at, NOW()),
           status = 'CONSUMED', updated_at = NOW()
       WHERE id = $1 AND status IN ('ACTIVE', 'VERIFIED') AND consumed_at IS NULL AND expires_at > NOW()`,
      [challengeId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async upsertRateLimitBucket(bucketKey: string, windowStartedAt: string, attempts: number): Promise<void> {
    await this.client.query(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempts)
       VALUES ($1, $2, $3)
       ON CONFLICT (bucket_key) DO UPDATE SET
         window_started_at = EXCLUDED.window_started_at,
         attempts = EXCLUDED.attempts,
         updated_at = NOW()`,
      [bucketKey, windowStartedAt, attempts],
    );
  }

  async createPendingRegistration(input: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    passwordSalt: string;
    passwordDigest: string;
    deviceId: string;
    challengeId?: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO pending_registrations
        (id, full_name, email, phone_number, password_salt, password_digest,
         device_id, challenge_id, expires_at)
       VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8, $9)`,
      [input.id, input.fullName, input.email, input.phoneNumber, input.passwordSalt, input.passwordDigest, input.deviceId, input.challengeId ?? null, input.expiresAt],
    );
  }

  async lockPendingRegistration(id: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      "SELECT * FROM pending_registrations WHERE id = $1 FOR UPDATE",
      [id],
    );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async consumePendingRegistration(id: string): Promise<boolean> {
    const result = await this.client.query(
      "DELETE FROM pending_registrations WHERE id = $1 RETURNING id",
      [id],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async findAndLockPendingByContact(email: string, phoneNumber: string): Promise<Array<{ id: string; isExpired: boolean }>> {
    const result = await this.client.query(
      `
        SELECT id, expires_at <= NOW() AS is_expired
        FROM pending_registrations
        WHERE lower(email) = lower($1) OR phone_number = $2
        ORDER BY id
        FOR UPDATE
      `,
      [email, phoneNumber]
    );
    return result.rows.map((row) => {
      const rowId = row.id;
      const isExpired = row.is_expired;
      if (typeof rowId !== "string" || rowId.trim() === "") {
        throw new Error("Database returned invalid id for pending registration.");
      }
      if (typeof isExpired !== "boolean") {
        throw new Error("Database returned invalid is_expired for pending registration.");
      }
      return { id: rowId, isExpired };
    });
  }
}
