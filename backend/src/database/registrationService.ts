import { randomUUID } from "node:crypto";

import { UnitOfWork } from "./unitOfWork.js";
import { isUniqueViolation } from "./postgresErrors.js";
import { RelationalConflictError, RelationalNotFoundError } from "./commandErrors.js";
import { AccountRepository } from "./repositories/accountRepository.js";
import { AuditRepository } from "./repositories/auditRepository.js";
import { CustomerRepository } from "./repositories/customerRepository.js";
import { OutboxRepository } from "./repositories/outboxRepository.js";
import { conflict, invalidRequest, rateLimited, unauthorized } from "../errors.js";
import { fingerprint, hashOpaqueToken, hashPasswordAsync } from "../security.js";
import type { MfaChallengeResponse, PersistentMfaService } from "../mfa/persistentMfaService.js";
import { MfaRepository } from "./repositories/mfaRepository.js";

export type RegistrationCommandInput = {
  pendingRegistrationId: string;
  customerId?: string;
  accountId?: string;
  traceId?: string;
};

export type RegistrationBeginInput = {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
};

/** Atomic registration cutover primitive for the normalized identity tables. */
export class RelationalRegistrationService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async begin(
    input: RegistrationBeginInput,
    deviceId: string,
    mfaService: PersistentMfaService,
    networkFingerprint: string,
  ): Promise<MfaChallengeResponse> {
    const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const phoneNumber = typeof input.phoneNumber === "string" ? input.phoneNumber.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!fullName) throw invalidRequest("fullName is required.", { fullName: "fullName is required." });
    if (!/^\S+@\S+\.\S+$/.test(email)) throw invalidRequest("Email is invalid.", { email: "Email is invalid." });
    if (!phoneNumber) throw invalidRequest("phoneNumber is required.", { phoneNumber: "phoneNumber is required." });
    if (password.length < 8) throw invalidRequest("Password is too short.", { password: "Password must contain at least 8 characters." });
    const passwordMaterial = await hashPasswordAsync(password);
    const pendingRegistrationId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await this.unitOfWork.transaction(async ({ client }) => {
      const customers = new CustomerRepository(client);
      const mfa = new MfaRepository(client);
      const audit = new AuditRepository(client);

      const rate = await mfa.atomicRateLimit({
        bucketKey: `relational-registration:${networkFingerprint}`,
        windowSeconds: 600,
        maxAttempts: 5,
      });
      if (!rate.allowed) throw rateLimited("Too many registration attempts.", rate.retryAfterSeconds);

      if (await customers.findCustomerByEmail(email) || await customers.findCustomerByPhone(phoneNumber)) {
        throw conflict("Registration conflict.");
      }

      const pendingRows = await customers.findAndLockPendingByContact(email, phoneNumber);
      if (pendingRows.length > 1) {
        throw conflict("Registration conflict.");
      }

      if (pendingRows.length === 1) {
        const row = pendingRows[0];
        if (row.isExpired !== true) {
          throw conflict("Registration conflict.");
        }

        const completionCheck = await client.query(
          "SELECT 1 FROM registration_completions WHERE pending_registration_id = $1",
          [row.id]
        );
        if (completionCheck.rows.length > 0) {
          throw conflict("Registration conflict.");
        }

        await mfa.cancelChallengesByPendingRegistration(String(row.id));
        await customers.consumePendingRegistration(String(row.id));

        await audit.append({
          id: randomUUID(),
          eventType: "REGISTRATION_PENDING_CLEANUP",
          resourceId: String(row.id),
          occurredAt: new Date().toISOString(),
          payload: {}
        });
      }

      try {
        await customers.createPendingRegistration({
          id: pendingRegistrationId,
          fullName,
          email,
          phoneNumber,
          passwordSalt: passwordMaterial.salt,
          passwordDigest: passwordMaterial.digest,
          deviceId,
          expiresAt,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const constraint = (error as { constraint?: string }).constraint;
          if (constraint === "pending_registrations_email_idx" || constraint === "pending_registrations_phone_idx") {
            throw conflict("Registration conflict.");
          }
        }
        throw error;
      }

      await audit.append({
        id: randomUUID(),
        eventType: "REGISTRATION_STARTED",
        resourceId: pendingRegistrationId,
        occurredAt: new Date().toISOString(),
        payload: {}
      });
    }, { maxRetries: 1 });

    try {
      return await mfaService.createEmailChallenge({
        pendingRegistrationId,
        deviceId,
        purpose: "REGISTRATION_EMAIL_VERIFY",
        destination: email,
        resourceId: pendingRegistrationId,
        requestFingerprint: fingerprint({ email, phoneNumber }),
        networkFingerprint,
      });
    } catch (error) {
      await this.unitOfWork.transaction(async ({ client }) => {
        await new MfaRepository(client).cancelChallengesByPendingRegistration(pendingRegistrationId);
        await client.query("DELETE FROM pending_registrations WHERE id = $1", [pendingRegistrationId]);
      }, { maxRetries: 1 });
      throw error;
    }
  }

  async verify(
    challengeId: string,
    proof: string,
    deviceId: string,
    mfaService: PersistentMfaService,
  ): Promise<{ customerId: string; accountId: string }> {
    const challengeHash = hashOpaqueToken(challengeId);
    const context = await this.unitOfWork.transaction(async ({ client }) => {
      const result = await client.query(
        `SELECT pending_registration_id, resource_id, request_fingerprint, device_id, purpose
           FROM auth_challenges WHERE id = $1`,
        [challengeHash],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row || row.purpose !== "REGISTRATION_EMAIL_VERIFY" || String(row.device_id) !== deviceId) {
        throw unauthorized("Registration challenge is invalid or expired.");
      }
      return {
        pendingRegistrationId: String(row.pending_registration_id ?? row.resource_id ?? ""),
        resourceId: row.resource_id ? String(row.resource_id) : null,
        requestFingerprint: row.request_fingerprint ? String(row.request_fingerprint) : null,
      };
    });
    if (!context.pendingRegistrationId) throw unauthorized("Registration challenge is invalid or expired.");
    await mfaService.verifyChallenge({
      challengeId,
      deviceId,
      proof,
      purpose: "REGISTRATION_EMAIL_VERIFY",
      resourceId: context.resourceId,
      requestFingerprint: context.requestFingerprint,
    });
    return this.complete({ pendingRegistrationId: context.pendingRegistrationId });
  }

  async complete(input: RegistrationCommandInput): Promise<{ customerId: string; accountId: string }> {
    return this.unitOfWork.transaction(async ({ client }) => {
      const customers = new CustomerRepository(client);
      const accounts = new AccountRepository(client);
      const audit = new AuditRepository(client);
      const outbox = new OutboxRepository(client);
      const pending = await customers.lockPendingRegistration(input.pendingRegistrationId);
      if (!pending) {
        const completed = await client.query(
          `SELECT customer_id, account_id FROM registration_completions
           WHERE pending_registration_id = $1`,
          [input.pendingRegistrationId],
        );
        if (completed.rows[0]) {
          return {
            customerId: String(completed.rows[0].customer_id),
            accountId: String(completed.rows[0].account_id),
          };
        }
        throw new RelationalNotFoundError("Pending registration not found.");
      }
      if (new Date(String(pending.expires_at)).getTime() <= Date.now()) {
        throw new RelationalConflictError("REGISTRATION_EXPIRED", "Registration challenge has expired.");
      }

      const customerId = input.customerId ?? randomUUID();
      const accountId = input.accountId ?? randomUUID();
      let customer;
      try {
        customer = await customers.createCustomer({
          id: customerId,
          fullName: String(pending.full_name),
          email: String(pending.email),
          phoneNumber: String(pending.phone_number),
          passwordSalt: String(pending.password_salt),
          passwordDigest: String(pending.password_digest),
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const constraint = (error as { constraint?: string }).constraint;
          if (constraint === "customers_email_key" || constraint === "customers_phone_number_key" || constraint === "customers_email_lower_idx") {
            throw new RelationalConflictError("CONFLICT", "Customer already exists.");
          }
        }
        throw error;
      }
      const account = await accounts.createForCustomer({
        id: accountId,
        customerId: customer.id,
      });
      // Seed the explicit feature entitlements atomically with registration so
      // an allowlisted sandbox policy does not leave a newly verified customer
      // unable to use the reference transfer/savings/credit flows.
      await client.query(
        `INSERT INTO customer_feature_entitlements (customer_id, feature_code)
         VALUES ($1, 'TRANSFERS'), ($1, 'SAVINGS'), ($1, 'CREDIT')
         ON CONFLICT (customer_id, feature_code) DO NOTHING`,
        [customer.id],
      );
      await client.query(
        `INSERT INTO registration_completions
          (pending_registration_id, customer_id, account_id)
         VALUES ($1, $2, $3)`,
        [input.pendingRegistrationId, customer.id, account.id],
      );
      // The challenge keeps an audit-safe resource reference, but the FK to
      // the short-lived pending payload must be detached before consumption.
      // Otherwise PostgreSQL correctly refuses to delete the registration
      // while auth_challenges still points at it.
      await client.query(
        `UPDATE auth_challenges
            SET pending_registration_id = NULL, updated_at = NOW()
          WHERE pending_registration_id = $1`,
        [input.pendingRegistrationId],
      );
      if (!(await customers.consumePendingRegistration(input.pendingRegistrationId))) {
        throw new RelationalConflictError("REGISTRATION_ALREADY_CONSUMED", "Registration challenge was already consumed.");
      }
      const now = new Date().toISOString();
      await audit.append({
        id: randomUUID(),
        eventType: "CUSTOMER_REGISTERED",
        actorCustomerId: customer.id,
        resourceId: account.id,
        occurredAt: now,
        payload: { traceId: input.traceId ?? null },
      });
      await outbox.append({
        id: randomUUID(),
        eventType: "CUSTOMER_REGISTERED",
        aggregateId: customer.id,
        deduplicationKey: `CUSTOMER_REGISTERED:${customer.id}`,
        occurredAt: now,
        traceId: input.traceId,
        payload: { customerId: customer.id, accountId: account.id },
      });
      return { customerId: customer.id, accountId: account.id };
    }, { traceId: input.traceId, maxRetries: 1 });
  }

  async cancel(challengeId: string, deviceId: string): Promise<void> {
    const challengeHash = hashOpaqueToken(challengeId);
    await this.unitOfWork.transaction(async ({ client }) => {
      const mfa = new MfaRepository(client);
      const customers = new CustomerRepository(client);

      const challenge = await mfa.lockChallenge(challengeHash);
      if (!challenge || String(challenge.device_id) !== deviceId || String(challenge.purpose) !== "REGISTRATION_EMAIL_VERIFY") {
        throw new RelationalNotFoundError("Registration challenge not found or invalid.");
      }

      if (challenge.pending_registration_id) {
        const completed = await client.query(
          `SELECT 1 FROM registration_completions WHERE pending_registration_id = $1`,
          [challenge.pending_registration_id],
        );
        if (completed.rows.length > 0) {
          throw new RelationalConflictError("REGISTRATION_ALREADY_COMPLETED", "Registration is already completed.");
        }
      }

      let needsCancel = false;
      const status = String(challenge.status);
      const expiresAt = new Date(String(challenge.expires_at)).getTime();

      if (status === "ACTIVE" && expiresAt > Date.now()) {
        needsCancel = true;
      }

      if (challenge.pending_registration_id) {
        await client.query(
          `UPDATE auth_challenges SET pending_registration_id = NULL, updated_at = NOW() WHERE pending_registration_id = $1`,
          [challenge.pending_registration_id],
        );
        await customers.consumePendingRegistration(String(challenge.pending_registration_id));
      }

      if (needsCancel) {
        await mfa.cancelChallenge(challengeHash);
      }
    });
  }
}
