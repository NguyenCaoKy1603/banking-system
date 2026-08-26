import { randomUUID } from "node:crypto";

import { AdminBootstrapService } from "../src/admin/auth/adminBootstrapService.js";
import { createRuntimeAdminInvitationProvider } from "../src/admin/auth/adminInvitationProvider.js";
import { StaffAuthService } from "../src/admin/auth/staffAuthService.js";
import { PostgresAdminRepository } from "../src/admin/repositories/adminRepository.js";
import { KeyEncryptionKeyringAdapter, LocalDevelopmentKeyEncryptionAdapter } from "../src/mfa/crypto.js";
import { readRuntimeConfig } from "../src/runtimeConfig.js";
import { createRuntimeSecretProvider, referenceFor } from "../src/secrets/runtimeSecrets.js";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required for Admin bootstrap.`);
  return normalized;
}

const runtimeConfig = readRuntimeConfig();
if (runtimeConfig.storage !== "postgres") throw new Error("Admin bootstrap requires PostgreSQL storage.");

const adminEmail = required(process.env.ADMIN_BOOTSTRAP_ADMIN_EMAIL, "ADMIN_BOOTSTRAP_ADMIN_EMAIL");
const controlEmail = required(process.env.ADMIN_BOOTSTRAP_CONTROL_EMAIL, "ADMIN_BOOTSTRAP_CONTROL_EMAIL");
const activationUrl = required(process.env.ADMIN_INVITATION_ACTIVATION_URL, "ADMIN_INVITATION_ACTIVATION_URL");
const secretProvider = createRuntimeSecretProvider(runtimeConfig);
const databaseSecret = await secretProvider.getSecret(referenceFor("databaseUrl", runtimeConfig.bankingEnvironment));
const repository = new PostgresAdminRepository({ connectionString: databaseSecret.value });

await repository.initialize();
try {
  const encryption = runtimeConfig.isProductionLike
    ? await KeyEncryptionKeyringAdapter.fromSecretProvider(
      secretProvider,
      {
        current: referenceFor("mfaEncryptionKey", runtimeConfig.bankingEnvironment),
        previous: referenceFor("mfaEncryptionKeyPrevious", runtimeConfig.bankingEnvironment),
      },
      { required: true },
    )
    : LocalDevelopmentKeyEncryptionAdapter.fromEnvironment({ required: true });
  const auth = new StaffAuthService({ repository, encryption, environmentScope: runtimeConfig.bankingEnvironment });
  const delivery = await createRuntimeAdminInvitationProvider({
    environment: runtimeConfig.bankingEnvironment,
    isProductionLike: runtimeConfig.isProductionLike,
    secretProvider,
  });
  const service = new AdminBootstrapService({
    repository,
    auth,
    delivery,
    activationUrl,
    isProductionLike: runtimeConfig.isProductionLike,
    reservedBy: `bootstrap:${process.pid}:${randomUUID()}`,
    staff: [
      {
        email: adminEmail,
        employeeCode: `ADMIN-${randomUUID().slice(0, 8)}`,
        displayName: process.env.ADMIN_BOOTSTRAP_ADMIN_NAME?.trim() || "Initial Admin",
        role: "ADMIN",
      },
      {
        email: controlEmail,
        employeeCode: `CONTROL-${randomUUID().slice(0, 8)}`,
        displayName: process.env.ADMIN_BOOTSTRAP_CONTROL_NAME?.trim() || "Initial Control",
        role: "CONTROL",
      },
    ],
  });
  const result = await service.run();
  // Deliberately print only non-sensitive identifiers and expiry metadata.
  console.log(JSON.stringify({ ...result, environment: runtimeConfig.bankingEnvironment }));
} finally {
  await repository.close();
}
