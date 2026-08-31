import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { unauthorized, rateLimited } from "../errors.js";
import type { AuthUser, LoginResponse } from "../types.js";
import { createOpaqueToken, hashOpaqueToken, hashPassword, verifyPasswordAsync } from "../security.js";
import { UnitOfWork } from "./unitOfWork.js";
import { CustomerRepository, type CustomerRow } from "./repositories/customerRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_SECONDS = 600;
const LOGIN_MAX_ATTEMPTS = 10;

const DUMMY_PASSWORD = hashPassword("relational-auth-dummy-password", Buffer.alloc(16, 0));

function publicUser(customer: CustomerRow): AuthUser {
  return {
    id: customer.id,
    fullName: customer.fullName,
    email: customer.email,
    phoneNumber: customer.phoneNumber,
    createdAt: customer.createdAt,
  };
}

function normalizeDeviceId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (!normalized) throw unauthorized("Device binding is required.");
  return normalized;
}

function configuredPositiveInt(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maximum) return fallback;
  return value;
}

/**
 * Direct relational authentication boundary used by the staged HTTP cutover.
 * It deliberately owns only identity/session rows; legacy BankingSystem state
 * is not read or written by these methods.
 */
export class RelationalAuthService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async loginPasswordOnly(email: string, password: string, deviceId: string): Promise<AuthUser> {
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const windowSeconds = configuredPositiveInt("LOGIN_RATE_LIMIT_WINDOW_SECONDS", LOGIN_WINDOW_SECONDS, 86_400);
    const maxAttempts = configuredPositiveInt("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", LOGIN_MAX_ATTEMPTS, 100);
    const outcome = await this.unitOfWork.transaction(async ({ client }) => {
      const keys = this.loginBucketKeys(normalizedEmail, normalizedDeviceId);
      const guard = await this.lockLoginBuckets(client, keys, windowSeconds, maxAttempts);
      if (guard.blocked) return { kind: "blocked" as const, retryAfterSeconds: guard.retryAfterSeconds };

      const result = await client.query("SELECT * FROM customers WHERE lower(email) = lower($1)", [normalizedEmail]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      const customer = row ? {
        id: String(row.id),
        fullName: String(row.full_name),
        email: String(row.email),
        phoneNumber: String(row.phone_number),
        passwordSalt: String(row.password_salt),
        passwordDigest: String(row.password_digest),
        createdAt: new Date(String(row.created_at)).toISOString(),
      } satisfies CustomerRow : null;
      const valid = await verifyPasswordAsync(
        typeof password === "string" ? password : "",
        customer?.passwordSalt ?? DUMMY_PASSWORD.salt,
        customer?.passwordDigest ?? DUMMY_PASSWORD.digest,
      );
      if (!customer || !valid) {
        const failure = await this.recordLoginFailure(client, keys, windowSeconds, maxAttempts);
        return failure.blocked
          ? { kind: "blocked" as const, retryAfterSeconds: failure.retryAfterSeconds }
          : { kind: "invalid" as const };
      }
      await this.resetLoginBuckets(client, keys);
      return { kind: "ok" as const, customer };
    });
    if (outcome.kind === "blocked") throw rateLimited("Too many login attempts.", outcome.retryAfterSeconds);
    if (outcome.kind === "invalid") throw unauthorized("Invalid credentials.");
    return publicUser(outcome.customer);
  }

  async issueSession(customerId: string, deviceId: string): Promise<LoginResponse> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    return this.unitOfWork.transaction(async ({ client }) => {
      const customers = new CustomerRepository(client);
      const customer = await customers.findCustomerById(customerId);
      if (!customer) throw unauthorized("User session is invalid.");
      const device = await customers.createDevice({
        id: randomUUID(),
        customerId: customer.id,
        deviceId: normalizedDeviceId,
        attestationStatus: "PENDING",
      });
      const accessToken = createOpaqueToken();
      const refreshToken = createOpaqueToken();
      const familyId = randomUUID();
      const sessionId = randomUUID();
      const now = Date.now();
      await customers.ensureRefreshSessionFamily(familyId, customer.id);
      await customers.createSession({
        id: sessionId,
        customerId: customer.id,
        deviceRecordId: device.id,
        familyId,
        accessTokenHash: hashOpaqueToken(accessToken),
        refreshTokenHash: hashOpaqueToken(refreshToken),
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
      });
      await customers.upsertRefreshSession({
        sessionKey: hashOpaqueToken(refreshToken),
        customerId: customer.id,
        familyId,
        deviceId: normalizedDeviceId,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
      });
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "SESSION_CREATED",
        actorCustomerId: customer.id,
        resourceId: sessionId,
        occurredAt: new Date(now).toISOString(),
        payload: { deviceId: normalizedDeviceId },
      });
      return {
        accessToken,
        refreshToken,
        expiresInSeconds: ACCESS_TOKEN_TTL_MS / 1000,
        user: publicUser(customer),
      };
    }, { maxRetries: 1 });
  }

  async authenticate(accessToken: string, deviceId: string): Promise<AuthUser> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const tokenHash = hashOpaqueToken(String(accessToken ?? ""));
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `SELECT c.id, c.full_name, c.email, c.phone_number, c.created_at
           FROM auth_sessions s
           JOIN customers c ON c.id = s.customer_id
           JOIN customer_devices d ON d.id = s.device_id
          WHERE s.access_token_hash = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > NOW()
            AND d.device_id = $2
            AND d.revoked_at IS NULL`,
        [tokenHash, normalizedDeviceId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw unauthorized("Access token is invalid or expired.");
      return {
        id: String(row.id),
        fullName: String(row.full_name),
        email: String(row.email),
        phoneNumber: String(row.phone_number),
        createdAt: new Date(String(row.created_at)).toISOString(),
      };
    });
  }

  async getUser(customerId: string): Promise<AuthUser> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const customer = await new CustomerRepository(client).findCustomerById(customerId);
      if (!customer) throw unauthorized("User session is invalid.");
      return publicUser(customer);
    });
  }

  async verifyCurrentPassword(customerId: string, password: string): Promise<boolean> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const customer = await new CustomerRepository(client).findCustomerById(customerId);
      if (!customer || typeof password !== "string") return false;
      return verifyPasswordAsync(password, customer.passwordSalt, customer.passwordDigest);
    });
  }

  async refresh(refreshToken: string, deviceId: string): Promise<LoginResponse> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const refreshHash = hashOpaqueToken(String(refreshToken ?? ""));
    return this.unitOfWork.transaction(async ({ client }) => {
      const sessionResult = await client.query(
        `SELECT s.*, r.expires_at AS refresh_expires_at, r.revoked_at AS refresh_revoked_at,
                c.full_name, c.email, c.phone_number, c.created_at,
                d.device_id AS bound_device_id, d.revoked_at AS device_revoked_at
           FROM auth_sessions s
           JOIN customers c ON c.id = s.customer_id
           JOIN customer_devices d ON d.id = s.device_id
           JOIN refresh_session_records r
             ON r.session_key = $1 AND r.customer_id = s.customer_id AND r.family_id = s.family_id
           JOIN refresh_session_families f
             ON f.family_id = s.family_id AND f.customer_id = s.customer_id AND f.revoked_at IS NULL
          WHERE s.refresh_token_hash = $1
          FOR UPDATE`,
        [refreshHash],
      );
      const row = sessionResult.rows[0] as Record<string, unknown> | undefined;
      if (!row || row.device_revoked_at || String(row.bound_device_id) !== normalizedDeviceId) {
        throw unauthorized("Refresh token is invalid.");
      }
      if (row.revoked_at || row.refresh_revoked_at) {
        // A rotated refresh token was presented again: revoke the complete
        // family before returning the generic error.
        await client.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL", [row.family_id]);
        await client.query("UPDATE refresh_session_families SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL", [row.family_id]);
        await client.query("UPDATE refresh_session_records SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL", [row.family_id]);
        throw unauthorized("Refresh token reuse detected.");
      }
      const expiresAt = new Date(String(row.refresh_expires_at)).getTime();
      if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
        throw unauthorized("Refresh token is invalid or expired.");
      }
      const accessToken = createOpaqueToken();
      const nextRefreshToken = createOpaqueToken();
      const nextSessionId = randomUUID();
      const now = Date.now();
      await client.query(
        `INSERT INTO auth_sessions
          (id, customer_id, device_id, family_id, access_token_hash,
           refresh_token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [nextSessionId, row.customer_id, row.device_id, row.family_id,
          hashOpaqueToken(accessToken), hashOpaqueToken(nextRefreshToken),
          new Date(now + ACCESS_TOKEN_TTL_MS).toISOString()],
      );
      await client.query(
        `UPDATE auth_sessions SET revoked_at = NOW(), replaced_by_session_id = $2
          WHERE id = $1 AND revoked_at IS NULL`,
        [row.id, nextSessionId],
      );
      await new CustomerRepository(client).upsertRefreshSession({
        sessionKey: refreshHash,
        customerId: String(row.customer_id),
        familyId: String(row.family_id),
        deviceId: normalizedDeviceId,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
        revoked: true,
      });
      await new CustomerRepository(client).upsertRefreshSession({
        sessionKey: hashOpaqueToken(nextRefreshToken),
        customerId: String(row.customer_id),
        familyId: String(row.family_id),
        deviceId: normalizedDeviceId,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
      });
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "REFRESH_ROTATED",
        actorCustomerId: String(row.customer_id),
        resourceId: nextSessionId,
        occurredAt: new Date(now).toISOString(),
      });
      const customer: CustomerRow = {
        id: String(row.customer_id),
        fullName: String(row.full_name),
        email: String(row.email),
        phoneNumber: String(row.phone_number),
        passwordSalt: "",
        passwordDigest: "",
        createdAt: new Date(String(row.created_at)).toISOString(),
      };
      return {
        accessToken,
        refreshToken: nextRefreshToken,
        expiresInSeconds: ACCESS_TOKEN_TTL_MS / 1000,
        user: publicUser(customer),
      };
    }, { maxRetries: 1 });
  }

  async revoke(refreshToken: string, deviceId: string): Promise<boolean> {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const refreshHash = hashOpaqueToken(String(refreshToken ?? ""));
    return this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `SELECT s.id, s.family_id, s.customer_id, d.device_id
           FROM auth_sessions s JOIN customer_devices d ON d.id = s.device_id
          WHERE s.refresh_token_hash = $1 FOR UPDATE`,
        [refreshHash],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row || String(row.device_id) !== normalizedDeviceId) return false;
      await client.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL", [row.family_id]);
      await client.query("UPDATE refresh_session_families SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL", [row.family_id]);
      await client.query("UPDATE refresh_session_records SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL", [row.family_id]);
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "SESSION_REVOKED",
        actorCustomerId: String(row.customer_id),
        resourceId: String(row.family_id),
      });
      return true;
    }, { maxRetries: 1 });
  }

  async revokeAllSessions(customerId: string): Promise<void> {
    await this.unitOfWork.transaction(async ({ client }) => {
      await client.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE customer_id = $1 AND revoked_at IS NULL", [customerId]);
      await client.query("UPDATE refresh_session_families SET revoked_at = NOW() WHERE customer_id = $1 AND revoked_at IS NULL", [customerId]);
      await client.query("UPDATE refresh_session_records SET revoked_at = NOW() WHERE customer_id = $1 AND revoked_at IS NULL", [customerId]);
      await new AuditRepository(client).append({
        id: randomUUID(),
        eventType: "ALL_SESSIONS_REVOKED",
        actorCustomerId: customerId,
      });
    }, { maxRetries: 1 });
  }

  private loginBucketKeys(email: string, deviceId: string): string[] {
    return [`relational-login:email:${email}`, `relational-login:device:${deviceId}`];
  }

  private async lockLoginBuckets(
    client: PoolClient,
    keys: string[],
    windowSeconds: number,
    maxAttempts: number,
  ): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
    await client.query(
      `INSERT INTO rate_limit_buckets (bucket_key, window_started_at, attempts, blocked_until, updated_at)
       SELECT key, NOW(), 0, NULL, NOW() FROM unnest($1::text[]) AS key
       ON CONFLICT (bucket_key) DO NOTHING`,
      [keys],
    );
    const result = await client.query<{ bucket_key: string; blocked_until: Date | null; attempts: number; retry_after: number }>(
      `SELECT bucket_key, blocked_until, attempts,
              COALESCE(EXTRACT(EPOCH FROM (blocked_until - NOW()))::int, $2) AS retry_after
         FROM rate_limit_buckets
        WHERE bucket_key = ANY($1::text[])
        ORDER BY bucket_key
        FOR UPDATE`,
      [keys, windowSeconds],
    );
    let blocked = false;
    let retryAfterSeconds = windowSeconds;
    for (const row of result.rows) {
      const expired = row.blocked_until !== null && new Date(String(row.blocked_until)).getTime() <= Date.now();
      if (expired) {
        await client.query(
          `UPDATE rate_limit_buckets
              SET window_started_at = NOW(), attempts = 0, blocked_until = NULL, updated_at = NOW()
            WHERE bucket_key = $1`,
            [row.bucket_key],
        );
        continue;
      }
      if ((row.blocked_until && new Date(String(row.blocked_until)).getTime() > Date.now()) || Number(row.attempts) >= maxAttempts) {
        blocked = true;
        retryAfterSeconds = Math.max(1, Math.min(windowSeconds, Number(row.retry_after) || windowSeconds));
      }
    }
    return { blocked, retryAfterSeconds };
  }

  private async recordLoginFailure(
    client: PoolClient,
    keys: string[],
    windowSeconds: number,
    maxAttempts: number,
  ): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
    let blocked = false;
    let retryAfterSeconds = windowSeconds;
    for (const bucketKey of keys) {
      const result = await client.query<{ attempts: number; retry_after: number }>(
        `UPDATE rate_limit_buckets
            SET window_started_at = CASE
                  WHEN window_started_at <= NOW() - ($2::text || ' seconds')::interval
                    THEN NOW() ELSE window_started_at END,
                attempts = CASE
                  WHEN window_started_at <= NOW() - ($2::text || ' seconds')::interval
                    THEN 1 ELSE attempts + 1 END,
                blocked_until = CASE
                  WHEN (CASE WHEN window_started_at <= NOW() - ($2::text || ' seconds')::interval THEN 1 ELSE attempts + 1 END) >= $3
                    THEN NOW() + ($2::text || ' seconds')::interval ELSE NULL END,
                updated_at = NOW()
          WHERE bucket_key = $1
          RETURNING attempts, COALESCE(EXTRACT(EPOCH FROM (blocked_until - NOW()))::int, $2) AS retry_after`,
        [bucketKey, windowSeconds, maxAttempts],
      );
      const row = result.rows[0];
      if (row && Number(row.attempts) >= maxAttempts) {
        blocked = true;
        retryAfterSeconds = Math.max(1, Math.min(windowSeconds, Number(row.retry_after) || windowSeconds));
      }
    }
    return { blocked, retryAfterSeconds };
  }

  private async resetLoginBuckets(client: PoolClient, keys: string[]): Promise<void> {
    await client.query(
      `UPDATE rate_limit_buckets
          SET attempts = 0, blocked_until = NULL, window_started_at = NOW(), updated_at = NOW()
        WHERE bucket_key = ANY($1::text[])`,
      [keys],
    );
  }
}
