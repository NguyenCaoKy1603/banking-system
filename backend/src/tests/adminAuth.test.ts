import assert from "node:assert/strict";
import test from "node:test";

import { LocalDevelopmentKeyEncryptionAdapter, generateTotp } from "../mfa/crypto.js";
import { InMemoryAdminRepository } from "../admin/repositories/adminRepository.js";
import { StaffAuthService } from "../admin/auth/staffAuthService.js";

test("staff invite activation requires password and TOTP before session issuance", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 7), "test-v1");
  const auth = new StaffAuthService({ repository, encryption });
  const invite = await auth.invite({ email: "admin@example.test", employeeCode: "ADMIN-1", displayName: "Admin", role: "ADMIN" });
  const secret = "JBSWY3DPEHPK3PXP";
  const activated = await auth.activate({ inviteToken: invite.token, password: "correct horse battery staple", totpSecret: secret });
  assert.equal(activated.staffId, invite.inviteId);
  const challenge = await auth.beginLogin("admin@example.test", "correct horse battery staple");
  assert.equal(challenge.mfaRequired, true);
  if (!challenge.mfaRequired) throw new Error("Admin login must require MFA.");
  const verified = await auth.verifyLoginMfa(challenge.challengeId, generateTotp(secret, Date.now()), "fixture-device");
  assert.equal(verified.staff.status, "ACTIVE");
  const session = await auth.authenticate(verified.tokens.accessToken);
  assert.equal(session.subject.roles[0]?.role, "ADMIN");
  await assert.rejects(() => auth.verifyCsrf(verified.tokens.accessToken, "wrong-csrf"), { code: "CSRF_INVALID" });
  await auth.logout(verified.tokens.accessToken);
  await assert.rejects(() => auth.authenticate(verified.tokens.accessToken), { code: "UNAUTHORIZED" });
});

test("staff refresh rotation and login brute-force limit fail closed", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 17), "test-refresh-v1");
  const auth = new StaffAuthService({ repository, encryption });
  const invite = await auth.invite({ email: "rotation@example.test", employeeCode: "ROT-1", displayName: "Rotation", role: "ADMIN" });
  const secret = "JBSWY3DPEHPK3PXP";
  await auth.activate({ inviteToken: invite.token, password: "rotation-password-2026", totpSecret: secret });
  const login = await auth.beginLogin("rotation@example.test", "rotation-password-2026");
  assert.equal(login.mfaRequired, true);
  if (!login.mfaRequired) throw new Error("Admin login must require MFA.");
  const verified = await auth.verifyLoginMfa(login.challengeId, generateTotp(secret, Date.now()), "rotation-device");
  const rotated = await auth.refresh(verified.tokens.refreshToken);
  assert.notEqual(rotated.accessToken, verified.tokens.accessToken);
  assert.notEqual(rotated.refreshToken, verified.tokens.refreshToken);
  await assert.rejects(() => auth.refresh(verified.tokens.refreshToken), { code: "UNAUTHORIZED" });
  await assert.rejects(() => auth.authenticate(verified.tokens.accessToken), { code: "UNAUTHORIZED" });
  const bruteInvite = await auth.invite({ email: "brute@example.test", employeeCode: "BRUTE-1", displayName: "Brute", role: "OPERATIONS" });
  await auth.activate({ inviteToken: bruteInvite.token, password: "brute-password-2026", totpSecret: secret });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => auth.beginLogin("brute@example.test", "wrong-password-2026"), { code: "UNAUTHORIZED" });
  }
  await assert.rejects(() => auth.beginLogin("brute@example.test", "wrong-password-2026"), { code: "RATE_LIMITED" });
  const mfaInvite = await auth.invite({ email: "mfa-brute@example.test", employeeCode: "MFA-BRUTE-1", displayName: "MFA Brute", role: "ADMIN" });
  await auth.activate({ inviteToken: mfaInvite.token, password: "mfa-brute-password-2026", totpSecret: secret });
  const mfaLogin = await auth.beginLogin("mfa-brute@example.test", "mfa-brute-password-2026");
  assert.equal(mfaLogin.mfaRequired, true);
  if (!mfaLogin.mfaRequired) throw new Error("Admin login must require MFA.");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => auth.verifyLoginMfa(mfaLogin.challengeId, "000000", "mfa-brute-device"), { code: "UNAUTHORIZED" });
  }
  await assert.rejects(() => auth.verifyLoginMfa(mfaLogin.challengeId, generateTotp(secret, Date.now()), "mfa-brute-device"), { code: "UNAUTHORIZED" });
});

test("Operations login uses password only after one-time TOTP enrollment", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 27), "test-operations-password-only-v1");
  const auth = new StaffAuthService({ repository, encryption });
  const secret = "JBSWY3DPEHPK3PXP";
  const invite = await auth.invite({ email: "operations@example.test", employeeCode: "OPS-1", displayName: "Operations", role: "OPERATIONS" });
  const activation = await auth.activate({ inviteToken: invite.token, password: "operations-password-2026", totpSecret: secret });

  const login = await auth.beginLogin("operations@example.test", "operations-password-2026", "ops-device");
  assert.equal(login.mfaRequired, false);
  if (login.mfaRequired) throw new Error("Operations login must not create a TOTP challenge.");
  const session = await auth.authenticate(login.tokens.accessToken);
  assert.equal(session.staff.id, activation.staffId);
  assert.equal(session.subject.roles[0]?.role, "OPERATIONS");
  await assert.rejects(() => auth.stepUp(login.tokens.accessToken, generateTotp(secret, Date.now())), { code: "UNAUTHORIZED" });

  await repository.createChallenge({ id: "stale-operations-login", staffId: activation.staffId, purpose: "LOGIN", expiresAt: new Date(Date.now() + 60_000).toISOString(), attempts: 0, consumedAt: null });
  await assert.rejects(() => auth.verifyLoginMfa("stale-operations-login", generateTotp(secret, Date.now())), { code: "UNAUTHORIZED" });
});
