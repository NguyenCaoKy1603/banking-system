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
  const invite = await auth.invite({ email: "control@example.test", employeeCode: "CTRL-1", displayName: "Control", role: "CONTROL" });
  const secret = "JBSWY3DPEHPK3PXP";
  const activated = await auth.activate({ inviteToken: invite.token, password: "correct horse battery staple", totpSecret: secret });
  assert.equal(activated.staffId, invite.inviteId);
  const challenge = await auth.beginLogin("control@example.test", "correct horse battery staple");
  const verified = await auth.verifyLoginMfa(challenge.challengeId, generateTotp(secret, Date.now()), "fixture-device");
  assert.equal(verified.staff.status, "ACTIVE");
  const session = await auth.authenticate(verified.tokens.accessToken);
  assert.equal(session.subject.roles[0]?.role, "CONTROL");
  await assert.rejects(() => auth.verifyCsrf(verified.tokens.accessToken, "wrong-csrf"), { code: "CSRF_INVALID" });
  await auth.logout(verified.tokens.accessToken);
  await assert.rejects(() => auth.authenticate(verified.tokens.accessToken), { code: "UNAUTHORIZED" });
});

test("staff refresh rotation and login brute-force limit fail closed", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 17), "test-refresh-v1");
  const auth = new StaffAuthService({ repository, encryption });
  const invite = await auth.invite({ email: "rotation@example.test", employeeCode: "ROT-1", displayName: "Rotation", role: "CONTROL" });
  const secret = "JBSWY3DPEHPK3PXP";
  await auth.activate({ inviteToken: invite.token, password: "rotation-password-2026", totpSecret: secret });
  const login = await auth.beginLogin("rotation@example.test", "rotation-password-2026");
  const verified = await auth.verifyLoginMfa(login.challengeId, generateTotp(secret, Date.now()), "rotation-device");
  const rotated = await auth.refresh(verified.tokens.refreshToken);
  assert.notEqual(rotated.accessToken, verified.tokens.accessToken);
  assert.notEqual(rotated.refreshToken, verified.tokens.refreshToken);
  await assert.rejects(() => auth.refresh(verified.tokens.refreshToken), { code: "UNAUTHORIZED" });
  await assert.rejects(() => auth.authenticate(verified.tokens.accessToken), { code: "UNAUTHORIZED" });
  const bruteInvite = await auth.invite({ email: "brute@example.test", employeeCode: "BRUTE-1", displayName: "Brute", role: "SUPPORT" });
  await auth.activate({ inviteToken: bruteInvite.token, password: "brute-password-2026", totpSecret: secret });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => auth.beginLogin("brute@example.test", "wrong-password-2026"), { code: "UNAUTHORIZED" });
  }
  await assert.rejects(() => auth.beginLogin("brute@example.test", "wrong-password-2026"), { code: "RATE_LIMITED" });
  const mfaInvite = await auth.invite({ email: "mfa-brute@example.test", employeeCode: "MFA-BRUTE-1", displayName: "MFA Brute", role: "SUPPORT" });
  await auth.activate({ inviteToken: mfaInvite.token, password: "mfa-brute-password-2026", totpSecret: secret });
  const mfaLogin = await auth.beginLogin("mfa-brute@example.test", "mfa-brute-password-2026");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(() => auth.verifyLoginMfa(mfaLogin.challengeId, "000000", "mfa-brute-device"), { code: "UNAUTHORIZED" });
  }
  await assert.rejects(() => auth.verifyLoginMfa(mfaLogin.challengeId, generateTotp(secret, Date.now()), "mfa-brute-device"), { code: "UNAUTHORIZED" });
});
