import { randomUUID } from "node:crypto";

import { LocalDevelopmentKeyEncryptionAdapter } from "../src/mfa/crypto.js";
import { PostgresAdminRepository } from "../src/admin/repositories/adminRepository.js";
import { StaffAuthService } from "../src/admin/auth/staffAuthService.js";

const adminEmail = process.env.ADMIN_BOOTSTRAP_ADMIN_EMAIL?.trim();
const controlEmail = process.env.ADMIN_BOOTSTRAP_CONTROL_EMAIL?.trim();
if (!adminEmail || !controlEmail || adminEmail.toLowerCase() === controlEmail.toLowerCase()) {
  throw new Error("ADMIN_BOOTSTRAP_ADMIN_EMAIL and ADMIN_BOOTSTRAP_CONTROL_EMAIL must be two different emails.");
}

const repository = new PostgresAdminRepository();
await repository.initialize();
try {
  await repository.reserveBootstrap(`bootstrap:${process.pid}`);
  const existing = (await repository.listStaff()).filter((staff) => staff.status !== "DISABLED");
  if (existing.length > 0) throw new Error("Admin bootstrap has already been completed or staff already exists; use the audited recovery procedure.");
  const encryption = LocalDevelopmentKeyEncryptionAdapter.fromEnvironment({ required: true });
  const auth = new StaffAuthService({ repository, encryption });
  const adminInvite = await auth.invite({ email: adminEmail, employeeCode: `ADMIN-${randomUUID().slice(0, 8)}`, displayName: "Initial Admin", role: "ADMIN" });
  const controlInvite = await auth.invite({ email: controlEmail, employeeCode: `CONTROL-${randomUUID().slice(0, 8)}`, displayName: "Initial Control", role: "CONTROL" });
  await repository.completeBootstrap();
  // Tokens are intentionally not printed or persisted in plaintext. Deliver
  // the invitation through an approved secure channel in the operator runbook.
  console.log(JSON.stringify({ event: "admin_bootstrap_completed", adminInviteId: adminInvite.inviteId, controlInviteId: controlInvite.inviteId, expiresAt: adminInvite.expiresAt }));
} finally {
  await repository.close();
}
