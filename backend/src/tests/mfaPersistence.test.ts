import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { LocalDevelopmentKeyEncryptionAdapter, OtpDigestKeyring, generateTotp } from "../mfa/crypto.js";
import { PersistentMfaService } from "../mfa/persistentMfaService.js";
import { hashOpaqueToken, hashPassword } from "../security.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) {
  assertDisposableDatabaseResetAllowed(databaseUrl, process.env, { targetEnvName: "RELATIONAL_DATABASE_URL" });
}

test("persistent MFA lifecycle is transactional, one-time and restart-safe", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "mfa-test-v1");
  const otpDigestKeyring = new OtpDigestKeyring({
    current: { id: "otp-test-v1", value: Buffer.alloc(32, 9) },
  });
  let now = Date.now();
  const service = (): PersistentMfaService => new PersistentMfaService({
    unitOfWork,
    encryption,
    otpDigestKeyring,
    environmentScope: "test",
    clock: () => now,
  });
  const customerId = randomUUID();
  const password = hashPassword("Password1");
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'MFA Persistence User', $2, $3, $4, $5, NOW())`,
    [customerId, `mfa-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`, password.salt, password.digest],
  );
  t.after(async () => database.close());

  const initial = service();
  const enrollment = await initial.beginTotpEnrollment({
    customerId,
    email: `mfa-${customerId}@example.test`,
    displayName: "Test authenticator",
  });
  assert.equal(enrollment.status, "PENDING");
  assert.match(enrollment.otpauthUri, /^otpauth:\/\/totp\//);
  const storedPending = await database.query<{ secret_ciphertext: string; status: string }>(
    "SELECT secret_ciphertext, status FROM mfa_credentials WHERE id = $1",
    [enrollment.credentialId],
  );
  assert.equal(storedPending.rows[0]?.status, "PENDING");
  assert.ok(storedPending.rows[0]?.secret_ciphertext);
  assert.equal(storedPending.rows[0]?.secret_ciphertext.includes(enrollment.manualSetupKey), false);

  const confirmation = await initial.confirmTotpEnrollment({
    customerId,
    credentialId: enrollment.credentialId,
    code: generateTotp(enrollment.manualSetupKey, now),
  });
  assert.equal(confirmation.status, "ACTIVE");
  assert.equal(confirmation.recoveryCodes.length, 10);

  now += 30_000;
  const loginService = service();
  const loginChallenge = await loginService.beginLoginChallenge({ customerId, deviceId: "mfa-device" });
  const loginCode = generateTotp(enrollment.manualSetupKey, now);
  const concurrent = await Promise.allSettled([
    loginService.verifyChallenge({ challengeId: loginChallenge.challengeId, customerId, deviceId: "mfa-device", proof: loginCode, purpose: "LOGIN" }),
    loginService.verifyChallenge({ challengeId: loginChallenge.challengeId, customerId, deviceId: "mfa-device", proof: loginCode, purpose: "LOGIN" }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const consumed = await database.query<{ status: string; consumed_at: string | null }>(
    "SELECT status, consumed_at FROM auth_challenges WHERE id = $1",
    [hashOpaqueToken(loginChallenge.challengeId)],
  );
  assert.equal(consumed.rows[0]?.status, "CONSUMED");
  assert.ok(consumed.rows[0]?.consumed_at);

  const restarted = service();
  await assert.rejects(
    restarted.verifyChallenge({ challengeId: loginChallenge.challengeId, customerId, deviceId: "mfa-device", proof: loginCode, purpose: "LOGIN" }),
  );

  now += 30_000;
  const lostCardId = randomUUID();
  const lostFingerprint = `reported-lost:${lostCardId}`;
  const lostChallenge = await restarted.beginTotpChallenge({
    customerId,
    deviceId: "mfa-device",
    purpose: "CARD_REPORT_LOST",
    resourceId: lostCardId,
    requestFingerprint: lostFingerprint,
  });
  const lostCode = generateTotp(enrollment.manualSetupKey, now);
  await assert.rejects(
    restarted.verifyChallenge({
      challengeId: lostChallenge.challengeId,
      customerId,
      deviceId: "mfa-device",
      proof: lostCode,
      purpose: "CARD_UNLOCK",
      resourceId: lostCardId,
      requestFingerprint: lostFingerprint,
    }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "STEP_UP_VERIFICATION_FAILED",
  );
  assert.equal((await restarted.verifyChallenge({
    challengeId: lostChallenge.challengeId,
    customerId,
    deviceId: "mfa-device",
    proof: lostCode,
    purpose: "CARD_REPORT_LOST",
    resourceId: lostCardId,
    requestFingerprint: lostFingerprint,
  })).customerId, customerId);

  const expiredChallenge = await restarted.beginTotpChallenge({ customerId, deviceId: "mfa-device", purpose: "MFA_FACTOR_CHANGE" });
  now += 5 * 60 * 1000 + 1;
  await assert.rejects(
    restarted.verifyChallenge({ challengeId: expiredChallenge.challengeId, customerId, deviceId: "mfa-device", proof: loginCode, purpose: "MFA_FACTOR_CHANGE" }),
  );
  const expired = await database.query<{ status: string }>(
    "SELECT status FROM auth_challenges WHERE id = $1",
    [hashOpaqueToken(expiredChallenge.challengeId)],
  );
  assert.equal(expired.rows[0]?.status, "EXPIRED");

  const retryChallenge = await restarted.beginTotpChallenge({ customerId, deviceId: "retry-device", purpose: "MFA_FACTOR_CHANGE" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      restarted.verifyChallenge({ challengeId: retryChallenge.challengeId, customerId, deviceId: "retry-device", proof: "000000", purpose: "MFA_FACTOR_CHANGE" }),
    );
  }
  const locked = await database.query<{ status: string; attempts: number }>(
    "SELECT status, attempts FROM auth_challenges WHERE id = $1",
    [hashOpaqueToken(retryChallenge.challengeId)],
  );
  assert.equal(locked.rows[0]?.status, "LOCKED");
  assert.equal(Number(locked.rows[0]?.attempts), 5);

  const previousCooldown = process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS;
  process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS = "0";
  try {
    const recovery = await restarted.verifyRecoveryCode(customerId, confirmation.recoveryCodes[0]!);
    await assert.rejects(() => restarted.verifyRecoveryCode(customerId, confirmation.recoveryCodes[0]!));
    await restarted.completeRecovery({ recoveryToken: recovery.recoveryToken });
    assert.equal((await restarted.listCredentials(customerId)).filter((item) => item.status === "ACTIVE").length, 0);

    const recoveryEnrollment = await restarted.beginRecoveryTotpEnrollment({ recoveryToken: recovery.recoveryToken });
    const recoveryConfirmation = await restarted.confirmTotpEnrollment({
      recoveryToken: recovery.recoveryToken,
      credentialId: recoveryEnrollment.credentialId,
      code: generateTotp(recoveryEnrollment.manualSetupKey, now),
    });
    assert.equal(recoveryConfirmation.status, "ACTIVE");
  } finally {
    if (previousCooldown === undefined) delete process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS;
    else process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS = previousCooldown;
  }

  const securityEvents = await database.query<{ event_type: string; metadata: string }>(
    "SELECT event_type, metadata::text FROM auth_security_events WHERE customer_id = $1 ORDER BY occurred_at",
    [customerId],
  );
  const eventTypes = securityEvents.rows.map((row) => row.event_type);
  assert.ok(eventTypes.includes("MFA_ENROLLMENT_STARTED"));
  assert.ok(eventTypes.includes("MFA_ENROLLED"));
  assert.ok(eventTypes.includes("MFA_VERIFY_SUCCEEDED"));
  assert.ok(eventTypes.includes("MFA_VERIFY_FAILED"));
  assert.ok(eventTypes.includes("MFA_RECOVERY_STARTED"));
  assert.ok(eventTypes.includes("MFA_RECOVERY_COMPLETED"));
  assert.ok(securityEvents.rows.every((row) => !row.metadata.includes(enrollment.manualSetupKey)));
});

test("rotate recovery codes revokes old codes, persists new active batch and records security event", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "mfa-test-v1");
  const otpDigestKeyring = new OtpDigestKeyring({
    current: { id: "otp-test-v1", value: Buffer.alloc(32, 9) },
  });
  let now = Date.now();
  const service = new PersistentMfaService({
    unitOfWork,
    encryption,
    otpDigestKeyring,
    environmentScope: "test",
    clock: () => now,
  });
  const customerId = randomUUID();
  const password = hashPassword("Password1");
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'MFA Rotate User', $2, $3, $4, $5, NOW())`,
    [customerId, `mfa-rotate-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`, password.salt, password.digest],
  );
  t.after(async () => database.close());

  // 1. Initial TOTP enrollment generates first batch of 10 recovery codes
  const enrollment = await service.beginTotpEnrollment({
    customerId,
    email: `mfa-rotate-${customerId}@example.test`,
    displayName: "Primary authenticator",
  });
  const confirmation = await service.confirmTotpEnrollment({
    customerId,
    credentialId: enrollment.credentialId,
    code: generateTotp(enrollment.manualSetupKey, now),
  });
  assert.equal(confirmation.recoveryCodes.length, 10);

  const initialCodesInDb = await database.query<{ status: string }>(
    "SELECT status FROM mfa_recovery_codes WHERE customer_id = $1 ORDER BY created_at",
    [customerId],
  );
  assert.equal(initialCodesInDb.rows.length, 10);
  assert.ok(initialCodesInDb.rows.every((row) => row.status === "ACTIVE"));

  // 2. Rotate recovery codes
  now += 10_000;
  const rotatedCodes = await service.rotateRecoveryCodes(customerId);
  assert.equal(rotatedCodes.length, 10);

  // Assert counts without logging or comparing plaintext values
  const allCodesInDb = await database.query<{ status: string; revoked_at: string | null }>(
    "SELECT status, revoked_at FROM mfa_recovery_codes WHERE customer_id = $1 ORDER BY created_at",
    [customerId],
  );
  assert.equal(allCodesInDb.rows.length, 20);
  const activeCount = allCodesInDb.rows.filter((r) => r.status === "ACTIVE").length;
  const revokedCount = allCodesInDb.rows.filter((r) => r.status === "REVOKED").length;
  assert.equal(activeCount, 10);
  assert.equal(revokedCount, 10);
  assert.ok(allCodesInDb.rows.filter((r) => r.status === "REVOKED").every((r) => r.revoked_at !== null));

  // 3. Old code cannot be verified
  await assert.rejects(
    service.verifyRecoveryCode(customerId, confirmation.recoveryCodes[0]!),
    (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 401,
  );

  // 4. New rotated code can be verified successfully
  const verification = await service.verifyRecoveryCode(customerId, rotatedCodes[0]!);
  assert.equal(verification.status, "PRIMARY_PROOF_VERIFIED");
  assert.ok(verification.recoveryToken);

  // 5. Audit event emitted
  const audit = await database.query<{ event_type: string }>(
    "SELECT event_type FROM auth_security_events WHERE customer_id = $1 AND event_type = 'MFA_RECOVERY_CODES_ROTATED'",
    [customerId],
  );
  assert.equal(audit.rows.length, 1);
});

test("revoke credential guards against removing last active factor and revokes chosen factor cleanly", { skip: !databaseUrl }, async (t) => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  const unitOfWork = new UnitOfWork(database);
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "mfa-test-v1");
  const otpDigestKeyring = new OtpDigestKeyring({
    current: { id: "otp-test-v1", value: Buffer.alloc(32, 9) },
  });
  let now = Date.now();
  const service = new PersistentMfaService({
    unitOfWork,
    encryption,
    otpDigestKeyring,
    environmentScope: "test",
    clock: () => now,
  });
  const customerId = randomUUID();
  const password = hashPassword("Password1");
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'MFA Revoke User', $2, $3, $4, $5, NOW())`,
    [customerId, `mfa-revoke-${customerId}@example.test`, `09${customerId.replaceAll("-", "").slice(0, 8)}`, password.salt, password.digest],
  );
  t.after(async () => database.close());

  // 1. Enroll first factor (Factor A)
  const factorA = await service.beginTotpEnrollment({
    customerId,
    email: `mfa-revoke-${customerId}@example.test`,
    displayName: "Factor A - Primary",
  });
  await service.confirmTotpEnrollment({
    customerId,
    credentialId: factorA.credentialId,
    code: generateTotp(factorA.manualSetupKey, now),
  });

  // 2. Precondition: with only Factor A active, attempting to revoke Factor A fails with MFA_LAST_FACTOR
  await assert.rejects(
    service.revokeCredential(customerId, factorA.credentialId),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "MFA_LAST_FACTOR",
  );

  // Verify Factor A remains ACTIVE in DB
  const factorAStatusPre = await database.query<{ status: string }>(
    "SELECT status FROM mfa_credentials WHERE id = $1",
    [factorA.credentialId],
  );
  assert.equal(factorAStatusPre.rows[0]?.status, "ACTIVE");

  // 3. Precondition before operation: Enroll second factor (Factor B)
  now += 30_000;
  const factorB = await service.beginTotpEnrollment({
    customerId,
    email: `mfa-revoke-${customerId}@example.test`,
    displayName: "Factor B - Secondary",
  });
  await service.confirmTotpEnrollment({
    customerId,
    credentialId: factorB.credentialId,
    code: generateTotp(factorB.manualSetupKey, now),
  });

  const activeBeforeRevoke = (await service.listCredentials(customerId)).filter((c) => c.status === "ACTIVE");
  assert.equal(activeBeforeRevoke.length, 2);

  // 4. Operation: Revoke Factor A
  await service.revokeCredential(customerId, factorA.credentialId);

  // 5. Assert: Factor A is REVOKED, while control Factor B remains ACTIVE
  const credentialsAfterRevoke = await service.listCredentials(customerId);
  const factorAAfter = credentialsAfterRevoke.find((c) => c.id === factorA.credentialId);
  const factorBAfter = credentialsAfterRevoke.find((c) => c.id === factorB.credentialId);
  assert.equal(factorAAfter?.status, "REVOKED");
  assert.equal(factorBAfter?.status, "ACTIVE");

  // 6. With only Factor B remaining active, attempting to revoke Factor B fails with MFA_LAST_FACTOR
  await assert.rejects(
    service.revokeCredential(customerId, factorB.credentialId),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "MFA_LAST_FACTOR",
  );
  assert.equal((await service.listCredentials(customerId)).filter((c) => c.status === "ACTIVE").length, 1);

  // 7. Security event emitted for factor revocation
  const audit = await database.query<{ event_type: string; resource_id: string }>(
    "SELECT event_type, resource_id FROM auth_security_events WHERE customer_id = $1 AND event_type = 'MFA_FACTOR_REVOKED'",
    [customerId],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0]?.resource_id, factorA.credentialId);
});
