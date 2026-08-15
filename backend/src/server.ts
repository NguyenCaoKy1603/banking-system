import { createBankingServer, createPersistentBankingServer } from "./http.js";
import { BankingSystem } from "./bankingSystem.js";
import { PostgresSnapshotRepository } from "./postgresSnapshotRepository.js";

type StepUpMethod = "OTP" | "BIOMETRIC";

function readConfiguredMethods(): StepUpMethod[] | undefined {
  const rawValue = process.env.BANKING_MFA_METHODS?.trim();
  if (!rawValue) {
    return undefined;
  }

  const methods = Array.from(
    new Set(
      rawValue.split(",").map((value) => value.trim()).filter(Boolean),
    ),
  );

  if (
    methods.length === 0 ||
    methods.some((method) => method !== "OTP" && method !== "BIOMETRIC")
  ) {
    throw new Error(
      "BANKING_MFA_METHODS must contain only OTP and/or BIOMETRIC.",
    );
  }

  return methods as StepUpMethod[];
}

if (process.env.NODE_ENV === "production" || process.env.BANKING_ENV === "production") {
  throw new Error(
    "The reference backend is sandbox-only and refuses to start in production.",
  );
}

const port = Number(process.env.PORT ?? 5000);
const allowedOrigins = (process.env.BANKING_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
async function start(): Promise<void> {
  const system = new BankingSystem({
    settleTransfersImmediately: process.env.BANKING_SETTLE_IMMEDIATELY !== "0",
    authChallengeMethods: readConfiguredMethods(),
  });
  const httpOptions = allowedOrigins.length > 0 ? { allowedOrigins } : undefined;
  let repository: PostgresSnapshotRepository | undefined;
  const server =
    process.env.BANKING_STORAGE === "postgres"
      ? (() => {
          repository = new PostgresSnapshotRepository();
          return createPersistentBankingServer(repository, system, httpOptions);
        })()
      : createBankingServer(system, httpOptions);

  if (repository) {
    await repository.initialize();
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `Banking reference backend listening on http://localhost:${port}/api/v1 (${process.env.BANKING_STORAGE === "postgres" ? "postgres snapshot" : "in-memory"} storage)`,
    );
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
