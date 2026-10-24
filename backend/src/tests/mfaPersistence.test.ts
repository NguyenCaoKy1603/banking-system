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

    // Verify that the recovered factor is genuinely usable for step-up challenges (not just confirmed)
    now += 30_000;
    const stepUpChallenge = await restarted.beginTotpChallenge({
      customerId,
      deviceId: "recovery-verify-device",
      purpose: "MFA_FACTOR_CHANGE",
    });
    const stepUpProof = generateTotp(recoveryEnrollment.manualSetupKey, now);
    const stepUpResult = await restarted.verifyChallenge({
      challengeId: stepUpChallenge.challengeId,
      customerId,
      deviceId: "recovery-verify-device",
      purpose: "MFA_FACTOR_CHANGE",
      proof: stepUpProof,
    });
    assert.equal(stepUpResult.customerId, customerId);
    assert.ok(stepUpResult.credentialId);
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

test("recovery request expiry respects cooldownUntil + 15m window across default and configured cooldowns", { skip: !databaseUrl }, async (t) => {
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
  async function createCustomerWithMfa(testLabel: string) {
    now = Date.now();
    const custId = randomUUID();
    const pw = hashPassword("Password1");
    await database.query(
      `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
       VALUES ($1, 'MFA TTL Test User', $2, $3, $4, $5, NOW())`,
      [custId, `mfa-${testLabel}-${custId}@example.test`, `09${custId.replaceAll("-", "").slice(0, 8)}`, pw.salt, pw.digest],
    );
    const s = service();
    const enrollment = await s.beginTotpEnrollment({
      customerId: custId,
      email: `mfa-${testLabel}-${custId}@example.test`,
      displayName: "TTL Authenticator",
    });
    const conf = await s.confirmTotpEnrollment({
      customerId: custId,
      credentialId: enrollment.credentialId,
      code: generateTotp(enrollment.manualSetupKey, now),
    });
    return { customerId: custId, recoveryCodes: conf.recoveryCodes };
  }

  const prevCooldown = process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS;
  try {
    // ─── Scenario 1: Default cooldown (24h) ──────────────────────────────
    delete process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS;
    const { customerId: c1, recoveryCodes: codes1 } = await createCustomerWithMfa("def");
    const s1 = service();
    const startTime1 = now;
    const recovery1 = await s1.verifyRecoveryCode(c1, codes1[0]!);

    const cooldownUntil1 = new Date(recovery1.cooldownUntil).getTime();
    const requestRow1 = await database.query<{ expires_at: string; cooldown_until: string }>(
      "SELECT expires_at, cooldown_until FROM mfa_recovery_requests WHERE id = $1",
      [recovery1.recoveryRequestId],
    );
    const expiresAt1 = new Date(requestRow1.rows[0]!.expires_at).getTime();

    // 1. Cooldown mặc định: request không hết hạn trước khi hết cooldown (expiresAt = cooldownUntil + 15m)
    assert.equal(cooldownUntil1, startTime1 + 24 * 60 * 60 * 1000);
    assert.equal(expiresAt1, cooldownUntil1 + 15 * 60 * 1000);
    assert.ok(expiresAt1 > cooldownUntil1);

    // 2. Trước cooldown: chưa được complete (status 409 MFA_RECOVERY_COOLDOWN)
    now = startTime1 + 10_000;
    await assert.rejects(
      s1.completeRecovery({ recoveryToken: recovery1.recoveryToken }),
      (err: unknown) =>
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "MFA_RECOVERY_COOLDOWN",
    );
    now = cooldownUntil1 - 1_000; // 1 second before cooldown ends
    await assert.rejects(
      s1.completeRecovery({ recoveryToken: recovery1.recoveryToken }),
      (err: unknown) =>
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "MFA_RECOVERY_COOLDOWN",
    );

    // 3. Tại cooldownUntil: có thể complete khi các điều kiện khác hợp lệ
    now = cooldownUntil1;
    const completed1 = await s1.completeRecovery({ recoveryToken: recovery1.recoveryToken });
    assert.equal(completed1.customerId, c1);

    // ─── Scenario 2: Hết hạn tại expiresAt ───────────────────────────────
    delete process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS;
    const { customerId: c2, recoveryCodes: codes2 } = await createCustomerWithMfa("exp");
    const s2 = service();
    const startTime2 = now;
    const recovery2 = await s2.verifyRecoveryCode(c2, codes2[0]!);
    const cooldownUntil2 = new Date(recovery2.cooldownUntil).getTime();
    const expiresAt2 = cooldownUntil2 + 15 * 60 * 1000;

    // 4. Tại expiresAt (và sau đó): request không còn hiệu lực (status 401 unauthorized / expired)
    now = expiresAt2;
    await assert.rejects(
      s2.completeRecovery({ recoveryToken: recovery2.recoveryToken }),
      (err: unknown) =>
        err instanceof Error &&
        "status" in err &&
        (err as { status: number }).status === 401,
    );
    now = expiresAt2 + 60_000; // 1 minute after expiry
    await assert.rejects(
      s2.completeRecovery({ recoveryToken: recovery2.recoveryToken }),
      (err: unknown) =>
        err instanceof Error &&
        "status" in err &&
        (err as { status: number }).status === 401,
    );

    // ─── Scenario 3: Cấu hình cooldown ngắn/0 vẫn có cửa sổ 15 phút sau cooldown ─
    process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS = "0";
    const { customerId: c3, recoveryCodes: codes3 } = await createCustomerWithMfa("zero");
    const s3 = service();
    const startTime3 = now;
    const recovery3 = await s3.verifyRecoveryCode(c3, codes3[0]!);
    const cooldownUntil3 = new Date(recovery3.cooldownUntil).getTime();
    const requestRow3 = await database.query<{ expires_at: string; cooldown_until: string }>(
      "SELECT expires_at, cooldown_until FROM mfa_recovery_requests WHERE id = $1",
      [recovery3.recoveryRequestId],
    );
    const expiresAt3 = new Date(requestRow3.rows[0]!.expires_at).getTime();

    // 5. Cấu hình cooldown 0: cooldownUntil = startTime, expiresAt = cooldownUntil + 15m
    assert.equal(cooldownUntil3, startTime3);
    assert.equal(expiresAt3, cooldownUntil3 + 15 * 60 * 1000);

    // Within the 15-minute window (e.g. at 14 minutes): can complete
    now = cooldownUntil3 + 14 * 60 * 1000;
    const completed3 = await s3.completeRecovery({ recoveryToken: recovery3.recoveryToken });
    assert.equal(completed3.customerId, c3);

    // Past the 15-minute window: request no longer valid
    const { customerId: c4, recoveryCodes: codes4 } = await createCustomerWithMfa("zero-exp");
    const s4 = service();
    const recovery4 = await s4.verifyRecoveryCode(c4, codes4[0]!);
    now = new Date(recovery4.cooldownUntil).getTime() + 15 * 60 * 1000;
    await assert.rejects(
      s4.completeRecovery({ recoveryToken: recovery4.recoveryToken }),
      (err: unknown) =>
        err instanceof Error &&
        "status" in err &&
        (err as { status: number }).status === 401,
    );
  } finally {
    if (prevCooldown === undefined) delete process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS;
    else process.env.BANKING_MFA_RECOVERY_COOLDOWN_MS = prevCooldown;
  }
});
