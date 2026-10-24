import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalRegistrationService } from "../database/registrationService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { LocalDevelopmentKeyEncryptionAdapter, OtpDigestKeyring } from "../mfa/crypto.js";
import { FakeEmailProvider } from "../mfa/delivery.js";
import { PersistentMfaService } from "../mfa/persistentMfaService.js";
import { hashOpaqueToken } from "../security.js";
import { DomainError } from "../errors.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });

test("relational registration persists only OTP digest, uses outbox intent and completes once", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 12 });
  const unitOfWork = new UnitOfWork(database);
  const delivery = new FakeEmailProvider();
  const mfa = new PersistentMfaService({
    unitOfWork,
    encryption: new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "mfa-registration-test-v1"),
    otpDigestKeyring: new OtpDigestKeyring({ current: { id: "otp-registration-test-v1", value: Buffer.alloc(32, 9) } }),
    environmentScope: "test",
    delivery,
  });
  const registration = new RelationalRegistrationService(unitOfWork);
  t.after(() => database.close());

  const email = `registration-${randomUUID()}@example.test`;
  const phone = `09${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const challenge = await registration.begin({
    fullName: "Persistent Registration User",
    email,
    phoneNumber: phone,
    password: "Password1!",
  }, "registration-device", mfa, "registration-network");
  assert.equal(challenge.method, "EMAIL_OTP");
  const code = delivery.latestCode("REGISTRATION_EMAIL_VERIFY");
  assert.match(code ?? "", /^\d{6}$/);

  // Cooldown is normally one minute. Move the disposable fixture clock
  // boundary back so the test can prove that resend creates a new one-time
  // challenge without weakening the production cooldown policy.
  await database.query(
    "UPDATE auth_challenges SET last_sent_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
    [hashOpaqueToken(challenge.challengeId)],
  );
  const resent = await mfa.resendRegistrationChallenge({
    challengeId: challenge.challengeId,
    deviceId: "registration-device",
    networkFingerprint: "registration-network",
  });
  assert.equal(resent.method, "EMAIL_OTP");
  assert.deepEqual(resent.methods, ["EMAIL_OTP"]);
  const resentCode = delivery.latestCode("REGISTRATION_EMAIL_VERIFY");
  assert.match(resentCode ?? "", /^\d{6}$/);
  assert.notEqual(resentCode, code);

  const challengeRow = await database.query<{ id: string; proof_digest: string; status: string }>(
    "SELECT id, proof_digest, status FROM auth_challenges WHERE purpose = 'REGISTRATION_EMAIL_VERIFY' ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(challengeRow.rows.length, 1);
  assert.ok(challengeRow.rows[0]?.proof_digest);
  assert.notEqual(challengeRow.rows[0]?.proof_digest, code);
  assert.equal(challengeRow.rows[0]?.status, "ACTIVE");

  const outbox = await database.query<{ event_type: string; payload: Record<string, unknown> }>(
    "SELECT event_type, payload FROM outbox_events WHERE event_type = 'security.registration_otp_requested.v1' ORDER BY occurred_at DESC LIMIT 1",
  );
  assert.equal(outbox.rows[0]?.event_type, "security.registration_otp_requested.v1");
  const payloadText = JSON.stringify(outbox.rows[0]?.payload ?? {});
  assert.equal(payloadText.includes(code!), false);
  assert.equal(payloadText.toLowerCase().includes("password"), false);
  assert.equal(payloadText.toLowerCase().includes("secret"), false);

  const concurrent = await Promise.allSettled([
    registration.verify(resent.challengeId, resentCode!, "registration-device", mfa),
    registration.verify(resent.challengeId, resentCode!, "registration-device", mfa),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const completed = concurrent.find((result) => result.status === "fulfilled");
  assert.ok(completed && completed.status === "fulfilled");

  const counts = await database.query<{ customers: string; accounts: string; completions: string; pending: string; consumed: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM customers WHERE email = $1) AS customers,
       (SELECT COUNT(*)::text FROM payment_accounts WHERE customer_id = (SELECT customer_id FROM registration_completions ORDER BY created_at DESC LIMIT 1)) AS accounts,
       (SELECT COUNT(*)::text FROM registration_completions) AS completions,
       (SELECT COUNT(*)::text FROM pending_registrations) AS pending,
       (SELECT COUNT(*)::text FROM auth_challenges WHERE id = $2 AND status = 'CONSUMED') AS consumed`,
    [email, hashOpaqueToken(resent.challengeId)],
  );
  assert.equal(counts.rows[0]?.customers, "1");
  assert.equal(counts.rows[0]?.accounts, "1");
  assert.equal(counts.rows[0]?.completions, "1");
  assert.equal(counts.rows[0]?.pending, "0");
  assert.equal(counts.rows[0]?.consumed, "1");

  await assert.rejects(
    registration.verify(resent.challengeId, resentCode!, "registration-device", mfa),
  );
  await assert.rejects(
    registration.begin({ fullName: "Duplicate", email, phoneNumber: `09${randomUUID().replaceAll("-", "").slice(0, 8)}`, password: "Password1!" }, "another-device", mfa, "a".repeat(64)),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "Must reject with DomainError");
      assert.equal(err.status, 409, "Must return HTTP status 409");
      assert.equal(err.code, "CONFLICT", "Must return CONFLICT error code");
      assert.equal(err.message, "Registration conflict.", "Must return generic privacy-preserving conflict message");
      return true;
    },
  );

  // Registration completion leaves the new customer ready for the persistent
  // TOTP enrollment flow; the secret is encrypted at rest and never returned
  // after the enrollment response.
  const customer = await database.query<{ id: string }>("SELECT id FROM customers WHERE email = $1", [email]);
  const enrollment = await mfa.beginTotpEnrollment({ customerId: customer.rows[0]!.id, email, displayName: "Registration authenticator" });
  assert.equal(enrollment.status, "PENDING");
  const encrypted = await database.query<{ secret_ciphertext: string }>("SELECT secret_ciphertext FROM mfa_credentials WHERE id = $1", [enrollment.credentialId]);
  assert.ok(encrypted.rows[0]?.secret_ciphertext);
  assert.equal(encrypted.rows[0]?.secret_ciphertext.includes(enrollment.manualSetupKey), false);
});
