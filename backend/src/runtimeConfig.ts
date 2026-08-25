import { createHash } from "node:crypto";

export type BankingRuntimeEnvironment =
  | "development"
  | "test"
  | "preview"
  | "staging"
  | "production-like";

export type RuntimeConfig = {
  nodeEnv: "development" | "test" | "preview" | "production";
  bankingEnvironment: BankingRuntimeEnvironment;
  moneyMode: "virtual";
  storage: "postgres" | "in-memory";
  isProductionLike: boolean;
  commitSha: string;
  releaseId: string;
  imageDigest: string;
};

const RUNTIME_ENVIRONMENTS = new Set<BankingRuntimeEnvironment>([
  "development",
  "test",
  "preview",
  "staging",
  "production-like",
]);
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required for the selected runtime environment.`);
  }
  return value.trim();
}

function originList(value: string | undefined, name: string): string[] {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes("*")) {
    throw new Error(`${name} must contain one or more exact origins; wildcard origins are forbidden.`);
  }
  if (origins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error(`${name} must use HTTPS origins outside local development.`);
  }
  return origins;
}

function rejectDeterministicSecrets(env: NodeJS.ProcessEnv): void {
  const forbidden = [
    "BANKING_SANDBOX_MFA_OTP",
    "BANKING_SANDBOX_OTP",
    "BANKING_TEST_OTP",
  ];
  const configured = forbidden.find((name) => env[name]?.trim());
  if (configured) {
    throw new Error(`${configured} is forbidden in staging and production-like runtimes.`);
  }
}

/**
 * Validates the deployment contract before any listener is opened.
 * `preview` remains a local-only compatibility environment; it is never a
 * promotion target. Staging and production-like must run Node in production
 * mode but continue to use virtual money only.
 */
export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = (env.NODE_ENV?.trim().toLowerCase() || "development") as RuntimeConfig["nodeEnv"];
  const bankingEnvironment = (env.BANKING_ENV?.trim().toLowerCase() || "development") as BankingRuntimeEnvironment;
  const moneyMode = (env.BANKING_MONEY_MODE?.trim().toLowerCase() || "virtual");
  const storage = (env.BANKING_STORAGE?.trim().toLowerCase() || "postgres") as RuntimeConfig["storage"];
  const isProductionLike = bankingEnvironment === "staging" || bankingEnvironment === "production-like";

  if (!new Set(["development", "test", "preview", "production"]).has(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, preview or production.");
  }
  if (env.BANKING_ENV?.trim().toLowerCase() === "production") {
    throw new Error("BANKING_ENV=production is reserved and is not enabled for this virtual-money reference system.");
  }
  if (!RUNTIME_ENVIRONMENTS.has(bankingEnvironment)) {
    throw new Error("BANKING_ENV must be development, test, preview, staging or production-like.");
  }
  if (moneyMode !== "virtual") {
    throw new Error("BANKING_MONEY_MODE must be virtual; real-money mode is not supported.");
  }
  if (storage !== "postgres" && storage !== "in-memory") {
    throw new Error("BANKING_STORAGE must be postgres or in-memory.");
  }

  if (isProductionLike) {
    if (nodeEnv !== "production") {
      throw new Error("Staging and production-like runtimes require NODE_ENV=production.");
    }
    if (storage !== "postgres") {
      throw new Error("Staging and production-like runtimes require PostgreSQL storage.");
    }
    required(env.DATABASE_URL, "DATABASE_URL");
    if (env.BANKING_MFA_REQUIRED !== "1") {
      throw new Error("BANKING_MFA_REQUIRED=1 is required in staging and production-like runtimes.");
    }
    const methods = (env.BANKING_MFA_METHODS?.trim() || "TOTP")
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean);
    if (methods.length !== 1 || methods[0] !== "TOTP") {
      throw new Error("Only TOTP MFA is allowed in staging and production-like runtimes.");
    }
    required(env.BANKING_OTP_PEPPER, "BANKING_OTP_PEPPER");
    required(env.BANKING_MFA_ENCRYPTION_KEY, "BANKING_MFA_ENCRYPTION_KEY");
    originList(env.BANKING_ALLOWED_ORIGINS, "BANKING_ALLOWED_ORIGINS");
    rejectDeterministicSecrets(env);

    const commitSha = required(env.BUILD_COMMIT_SHA, "BUILD_COMMIT_SHA");
    if (!SHA_PATTERN.test(commitSha)) {
      throw new Error("BUILD_COMMIT_SHA must be the full 40-character Git commit SHA in staging and production-like.");
    }
    const imageDigest = required(env.IMAGE_DIGEST, "IMAGE_DIGEST");
    if (!IMAGE_DIGEST_PATTERN.test(imageDigest)) {
      throw new Error("IMAGE_DIGEST must be a sha256 manifest digest in staging and production-like.");
    }
    return {
      nodeEnv,
      bankingEnvironment,
      moneyMode: "virtual",
      storage,
      isProductionLike,
      commitSha,
      releaseId: required(env.RELEASE_ID, "RELEASE_ID"),
      imageDigest,
    };
  }

  if (nodeEnv === "production") {
    throw new Error("NODE_ENV=production is only allowed with BANKING_ENV=staging or production-like.");
  }

  return {
    nodeEnv,
    bankingEnvironment,
    moneyMode: "virtual",
    storage,
    isProductionLike: false,
    commitSha: env.BUILD_COMMIT_SHA?.trim() || "local",
    releaseId: env.RELEASE_ID?.trim() || "local",
    imageDigest: env.IMAGE_DIGEST?.trim() || "unknown",
  };
}

export function hashRuntimeValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
