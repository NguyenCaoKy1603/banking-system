import { createBankingServer, createPersistentBankingServer } from "./http.js";
import { BankingSystem } from "./bankingSystem.js";
import { PostgresRelationalRepository } from "./database/postgresRelationalRepository.js";
import { KeyEncryptionKeyringAdapter, OtpDigestKeyring } from "./mfa/crypto.js";
import { PersistentMfaService } from "./mfa/persistentMfaService.js";
import { createRuntimeEmailProvider } from "./mfa/runtimeEmailProvider.js";
import { RelationalHttpBoundary } from "./database/relationalHttpBoundary.js";
import { readRuntimeConfig } from "./runtimeConfig.js";
import { resolveBankingBindHost } from "./serverBind.js";
import { runtimeMetadata } from "./runtimeMetadata.js";
import { createRuntimeSecretProvider, referenceFor } from "./secrets/runtimeSecrets.js";
import { resolveRuntimeAssistantConfig } from "./assistant/runtimeAssistantConfig.js";
import { AssistantRateLimiter } from "./assistant/index.js";
import { resolveFinancialAdviceConfig } from "./financialAdvice/index.js";

type StepUpMethod = "TOTP";

function readConfiguredMethods(): StepUpMethod[] | undefined {
  const rawValue = process.env.BANKING_MFA_METHODS?.trim();
  if (!rawValue) {
    return ["TOTP"];
  }

  const methods = Array.from(
    new Set(
      rawValue.split(",").map((value) => value.trim()).filter(Boolean),
    ),
  );

  if (
    methods.length === 0 ||
      methods.some((method) => method !== "TOTP")
  ) {
    throw new Error(
      "BANKING_MFA_METHODS must contain only TOTP in production-like runtime.",
    );
  }

  return methods as StepUpMethod[];
}

const runtimeConfig = readRuntimeConfig();

const port = Number(process.env.PORT ?? 5000);
const bindHost = resolveBankingBindHost();
const storage = runtimeConfig.storage;
const bankingEnvironment = runtimeConfig.bankingEnvironment;
const buildCommitSha = runtimeConfig.commitSha;
const allowedOrigins = (process.env.BANKING_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
async function start(): Promise<void> {
  const configuredMethods = readConfiguredMethods();
  let startupReady = false;
  const system = new BankingSystem({
    settleTransfersImmediately: process.env.BANKING_SETTLE_IMMEDIATELY !== "0",
    creditOverdueSeed: process.env.BANKING_SANDBOX_CREDIT_OVERDUE === "1",
    authChallengeMethods: configuredMethods,
    stepUpMethods: configuredMethods,
    savingsStepUpMethods: configuredMethods,
    creditPaymentStepUpMethods: configuredMethods,
    cardUnlockStepUpMethods: configuredMethods,
  });
  const assistantConfig = resolveRuntimeAssistantConfig();
  const assistantRateLimiter = new AssistantRateLimiter(assistantConfig);
  const financialAdviceConfig = resolveFinancialAdviceConfig();
  const httpOptions = {
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : undefined,
    environment: bankingEnvironment,
    storage,
    commitSha: buildCommitSha,
    assistantConfig,
    assistantRateLimiter,
    financialAdviceConfig,
    runtimeMetadata: runtimeMetadata({
      releaseId: runtimeConfig.releaseId,
      commitSha: runtimeConfig.commitSha,
      imageDigest: runtimeConfig.imageDigest,
      environment: runtimeConfig.bankingEnvironment,
      moneyMode: runtimeConfig.moneyMode,
    }),
    startupReady: () => startupReady,
    registrationFingerprintKey: runtimeConfig.registrationFingerprintKey,
  };
  let repository: PostgresRelationalRepository | undefined;
  let server;

  if (storage === "postgres") {
    const secretProvider = createRuntimeSecretProvider(runtimeConfig);
    const databaseSecret = await secretProvider.getSecret(referenceFor("databaseUrl", bankingEnvironment));
    repository = new PostgresRelationalRepository({ connectionString: databaseSecret.value });
    await repository.initialize();
    const emailDelivery = await createRuntimeEmailProvider({
      environment: bankingEnvironment,
      isProductionLike: runtimeConfig.isProductionLike,
      secretProvider,
    });
    const encryption = await KeyEncryptionKeyringAdapter.fromSecretProvider(
      secretProvider,
      {
        current: referenceFor("mfaEncryptionKey", bankingEnvironment),
        previous: referenceFor("mfaEncryptionKeyPrevious", bankingEnvironment),
      },
      {
        currentKeyId: process.env.BANKING_MFA_ENCRYPTION_KEY_ID?.trim(),
        previousKeyId: process.env.BANKING_MFA_ENCRYPTION_KEY_PREVIOUS_ID?.trim(),
        required: runtimeConfig.isProductionLike,
      },
    );
    const otpDigestKeyring = await OtpDigestKeyring.fromSecretProvider(
      secretProvider,
      {
        current: referenceFor("otpPepper", bankingEnvironment),
        previous: referenceFor("otpPepperPrevious", bankingEnvironment),
      },
      {
        currentKeyId: process.env.BANKING_OTP_PEPPER_KEY_ID?.trim(),
        previousKeyId: process.env.BANKING_OTP_PEPPER_PREVIOUS_KEY_ID?.trim(),
        required: runtimeConfig.isProductionLike,
      },
    );
    const mfaService = new PersistentMfaService({
      unitOfWork: repository.unitOfWork,
      encryption,
      otpDigestKeyring,
      environmentScope: bankingEnvironment,
      delivery: emailDelivery,
    });
    const relationalHttp = new RelationalHttpBoundary(repository.unitOfWork);
    if (runtimeConfig.persistenceMode === "relational-v2") relationalHttp.assertRelationalV2Complete();
    server = createPersistentBankingServer(repository, system, {
      ...httpOptions,
      mfaService,
      emailProviderHealth: () => emailDelivery.health(),
      relationalHttp: relationalHttp.enabled ? relationalHttp : undefined,
    });
  } else if (storage === "in-memory") {
    server = createBankingServer(system, httpOptions);
  } else {
    throw new Error(
      `BANKING_STORAGE must be either postgres or in-memory; received ${storage || "empty"}.`,
    );
  }

  if (repository) {
    await repository.healthCheck();
  }

  startupReady = true;

  server.listen(port, bindHost, () => {
    console.log(JSON.stringify({
      event: "server_started",
      startedAt: new Date().toISOString(),
      service: "banking-reference-backend",
      environment: bankingEnvironment,
      storage,
      port,
      bindHost,
      commitSha: buildCommitSha,
    }));
  });

  const shutdown = (): void => {
    server.close(() => {
      void repository?.close();
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
