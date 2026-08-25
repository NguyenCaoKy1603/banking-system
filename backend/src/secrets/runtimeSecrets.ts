import type { RuntimeConfig } from "../runtimeConfig.js";
import { LocalDevelopmentSecretProvider } from "./LocalDevelopmentSecretProvider.js";
import { ManagedSecretProvider, type ManagedSecretClient } from "./ManagedSecretProvider.js";
import { SecretCache } from "./secretCache.js";
import type { SecretProvider, SecretReference } from "./SecretProvider.js";

export const RUNTIME_SECRET_REFERENCES = Object.freeze({
  databaseUrl: { secretId: "database-credential", service: "database-client", purpose: "postgres-connection", envVar: "DATABASE_URL" },
  otpPepper: { secretId: "otp-pepper", service: "backend-api", purpose: "otp-digest", envVar: "BANKING_OTP_PEPPER" },
  otpPepperPrevious: { secretId: "otp-pepper-previous", service: "backend-api", purpose: "otp-digest-previous", envVar: "BANKING_OTP_PEPPER_PREVIOUS" },
  mfaEncryptionKey: { secretId: "mfa-encryption-key", service: "backend-api", purpose: "mfa-totp", envVar: "BANKING_MFA_ENCRYPTION_KEY" },
  mfaEncryptionKeyPrevious: { secretId: "mfa-encryption-key-previous", service: "backend-api", purpose: "mfa-totp-previous", envVar: "BANKING_MFA_ENCRYPTION_KEY_PREVIOUS" },
  notificationEndpointKey: { secretId: "notification-endpoint-key", service: "outbox-worker", purpose: "notification-endpoint", envVar: "NOTIFICATION_ENDPOINT_ENCRYPTION_KEY" },
  notificationEndpointKeyPrevious: { secretId: "notification-endpoint-key-previous", service: "outbox-worker", purpose: "notification-endpoint-previous", envVar: "NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_PREVIOUS" },
} as const);

export function createRuntimeSecretProvider(
  config: Pick<RuntimeConfig, "bankingEnvironment">,
  env: NodeJS.ProcessEnv = process.env,
  options: { managedClient?: ManagedSecretClient } = {},
): SecretProvider {
  if (config.bankingEnvironment === "development" || config.bankingEnvironment === "test" || config.bankingEnvironment === "preview") {
    return new SecretCache(new LocalDevelopmentSecretProvider(env, config.bankingEnvironment));
  }
  if (env.BANKING_SECRET_PROVIDER?.trim().toLowerCase() !== "managed") {
    throw new Error("Staging and production-like runtimes require BANKING_SECRET_PROVIDER=managed.");
  }
  return new SecretCache(new ManagedSecretProvider(options.managedClient));
}

export function referenceFor(
  key: keyof typeof RUNTIME_SECRET_REFERENCES,
  environment: RuntimeConfig["bankingEnvironment"],
): SecretReference {
  const value = RUNTIME_SECRET_REFERENCES[key];
  return { ...value, environment };
}
