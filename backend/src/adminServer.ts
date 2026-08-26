import { KeyEncryptionKeyringAdapter } from "./mfa/crypto.js";
import { InMemoryAdminRepository, PostgresAdminRepository } from "./admin/repositories/adminRepository.js";
import { StaffAuthService } from "./admin/auth/staffAuthService.js";
import { AdminActionEngine } from "./admin/actions/actionEngine.js";
import { createAdminServer } from "./admin/http/adminHttp.js";
import { readRuntimeConfig } from "./runtimeConfig.js";
import { runtimeMetadata } from "./runtimeMetadata.js";
import { createRuntimeSecretProvider, referenceFor } from "./secrets/runtimeSecrets.js";

const runtimeConfig = readRuntimeConfig();

const port = Number(process.env.ADMIN_PORT ?? 5001);
const bind = (process.env.ADMIN_BIND ?? "127.0.0.1").trim() || "127.0.0.1";
const storage = (process.env.ADMIN_STORAGE ?? process.env.BANKING_STORAGE ?? "postgres").trim().toLowerCase();
const environment = runtimeConfig.bankingEnvironment;
const allowedOrigins = (process.env.ADMIN_ALLOWED_ORIGINS ?? "http://localhost:5173").split(",").map((item) => item.trim()).filter(Boolean);
const secureCookies = process.env.ADMIN_SECURE_COOKIES === "1";

if (runtimeConfig.isProductionLike) {
  if (storage !== "postgres") {
    throw new Error("Staging and production-like admin runtimes require PostgreSQL storage.");
  }
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*") || allowedOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("ADMIN_ALLOWED_ORIGINS must contain exact HTTPS origins in staging and production-like runtimes.");
  }
}

async function start(): Promise<void> {
  const secretProvider = createRuntimeSecretProvider(runtimeConfig);
  const databaseSecret = storage === "postgres"
    ? await secretProvider.getSecret(referenceFor("databaseUrl", environment))
    : undefined;
  const repository = storage === "in-memory"
    ? new InMemoryAdminRepository()
    : new PostgresAdminRepository({ connectionString: databaseSecret?.value });
  await repository.initialize();
  const encryption = storage === "in-memory"
    ? KeyEncryptionKeyringAdapter.fromEnvironment({ required: false })
    : await KeyEncryptionKeyringAdapter.fromSecretProvider(
      secretProvider,
      {
        current: referenceFor("mfaEncryptionKey", environment),
        previous: referenceFor("mfaEncryptionKeyPrevious", environment),
      },
      {
        currentKeyId: process.env.BANKING_MFA_ENCRYPTION_KEY_ID?.trim(),
        previousKeyId: process.env.BANKING_MFA_ENCRYPTION_KEY_PREVIOUS_ID?.trim(),
        required: runtimeConfig.isProductionLike,
      },
    );
  const auth = new StaffAuthService({ repository, encryption, environmentScope: environment });
  const actions = new AdminActionEngine(repository, auth);
  const server = createAdminServer({
    repository,
    auth,
    actions,
    allowedOrigins,
    environment,
    commitSha: runtimeConfig.commitSha,
    runtimeMetadata: runtimeMetadata({
      service: "banking-admin-api",
      releaseId: runtimeConfig.releaseId,
      commitSha: runtimeConfig.commitSha,
      imageDigest: runtimeConfig.imageDigest,
      environment: runtimeConfig.bankingEnvironment,
      moneyMode: runtimeConfig.moneyMode,
    }),
    startupReady: true,
    secureCookies: runtimeConfig.isProductionLike || secureCookies,
  });
  server.listen(port, bind, () => {
    console.log(JSON.stringify({ event: "admin_server_started", service: "banking-admin-api", environment, storage, port, bind }));
  });
  const shutdown = (): void => { server.close(() => { void repository.close(); }); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}

void start().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
