import type { BankingRuntimeEnvironment } from "../runtimeConfig.js";
import { referenceFor } from "../secrets/runtimeSecrets.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";
import { HttpEmailProvider } from "./httpEmailProvider.js";
import { NullEmailProvider, type VerificationCodeDeliveryPort } from "./delivery.js";

type RuntimeEmailProviderOptions = {
  environment: BankingRuntimeEnvironment;
  isProductionLike: boolean;
  secretProvider: SecretProvider;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

const LOCAL_CAPTURE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "mailpit", "mailhog"]);

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number, allowZero = false): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${allowZero ? "non-negative" : "positive"}.`);
  return value;
}
function validateEndpoint(endpoint: string, productionLike: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("EMAIL_PROVIDER_URL must be a valid URL.");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("EMAIL_PROVIDER_URL must use HTTP or HTTPS.");
  if (parsed.username || parsed.password) throw new Error("EMAIL_PROVIDER_URL must not contain credentials.");
  if (productionLike && parsed.protocol !== "https:") throw new Error("Staging and production-like email delivery requires HTTPS.");
  if (!productionLike && !LOCAL_CAPTURE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Local email delivery must target a loopback or local capture service host.");
  }
  return parsed;
}

/**
 * Resolve the runtime OTP provider. `disabled` is a deliberate local-preview
 * mode only; staging and production-like startup fail closed when delivery is
 * not configured. The provider credential is fetched through the same secret
 * seam that staging will use later.
 */
export async function createRuntimeEmailProvider(options: RuntimeEmailProviderOptions): Promise<VerificationCodeDeliveryPort> {
  const env = options.env ?? process.env;
  const mode = (env.EMAIL_PROVIDER?.trim().toLowerCase() || "disabled");
  if (mode === "disabled") {
    if (options.isProductionLike) throw new Error("EMAIL_PROVIDER=disabled is forbidden in staging and production-like runtimes.");
    return new NullEmailProvider();
  }
  if (mode !== "http") throw new Error("EMAIL_PROVIDER must be http or disabled.");

  const endpointValue = env.EMAIL_PROVIDER_URL?.trim();
  if (!endpointValue) throw new Error("EMAIL_PROVIDER_URL is required when EMAIL_PROVIDER=http.");
  const endpoint = validateEndpoint(endpointValue, options.isProductionLike);
  let bearerToken = env.EMAIL_PROVIDER_TOKEN?.trim() || undefined;
  if (options.isProductionLike) {
    const secret = await options.secretProvider.getSecret(referenceFor("emailProviderToken", options.environment));
    bearerToken = secret.value.trim();
    if (!bearerToken) throw new Error("Managed email provider token is empty.");
  }
  return new HttpEmailProvider({
    endpoint: endpoint.toString(),
    bearerToken,
    timeoutMs: positiveInteger(env, "EMAIL_PROVIDER_TIMEOUT_MS", 5_000),
    maxAttempts: positiveInteger(env, "EMAIL_PROVIDER_MAX_ATTEMPTS", 3),
    retryDelayMs: positiveInteger(env, "EMAIL_PROVIDER_RETRY_DELAY_MS", 100, true),
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
  });
}
