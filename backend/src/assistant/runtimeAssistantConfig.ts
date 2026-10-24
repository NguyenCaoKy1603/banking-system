import { type AssistantConfig, resolveAssistantConfig } from "./helpConfig.js";
import {
  DEFAULT_RADOX_BASE_URL,
  DEFAULT_RADOX_MODEL,
  RadoxAssistantHelpProvider,
  validateRadoxApiKey,
  validateRadoxBaseUrl,
  validateRadoxModel,
} from "./radoxHelpProvider.js";

export const DEFAULT_RADOX_PROVIDER_TIMEOUT_MS = 15_000;
export const DEFAULT_RADOX_REQUEST_TIMEOUT_MS = 20_000;

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer; received '${value}'.`);
  }
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new Error(`${name} must be a positive integer; received '${value}'.`);
  }
  return num;
}

/**
 * Resolves runtime assistant configuration from environment variables.
 *
 * Fail-closed behavior:
 * - If ASSISTANT_ENABLED != "1", returns disabled configuration without instantiating any provider.
 * - If ASSISTANT_ENABLED == "1", strictly validates ASSISTANT_PROVIDER, ASSISTANT_MODEL,
 *   ASSISTANT_RADOX_API_KEY, ASSISTANT_RADOX_BASE_URL, ASSISTANT_PROVIDER_TIMEOUT_MS, and ASSISTANT_REQUEST_TIMEOUT_MS.
 * - Enforces that ASSISTANT_REQUEST_TIMEOUT_MS > ASSISTANT_PROVIDER_TIMEOUT_MS.
 *   Any missing or invalid configuration throws an error.
 */
export function resolveRuntimeAssistantConfig(
  env: NodeJS.ProcessEnv = process.env,
): AssistantConfig {
  const isEnabled = env.ASSISTANT_ENABLED === "1";
  if (!isEnabled) {
    return resolveAssistantConfig({ enabled: false });
  }

  const providerType = env.ASSISTANT_PROVIDER?.trim().toLowerCase();
  if (providerType !== "radox") {
    throw new Error(
      `ASSISTANT_PROVIDER must be 'radox' when ASSISTANT_ENABLED=1; received '${env.ASSISTANT_PROVIDER ?? "empty"}'.`,
    );
  }

  const rawApiKey = (env.ASSISTANT_RADOX_API_KEY || env.RADOX_API_KEY)?.trim();
  if (!rawApiKey) {
    throw new Error("ASSISTANT_RADOX_API_KEY is required when ASSISTANT_ENABLED=1 and ASSISTANT_PROVIDER=radox.");
  }
  const apiKey = validateRadoxApiKey(rawApiKey);

  const rawModel = env.ASSISTANT_MODEL?.trim() || DEFAULT_RADOX_MODEL;
  const model = validateRadoxModel(rawModel);

  const rawBaseUrl = env.ASSISTANT_RADOX_BASE_URL?.trim() || DEFAULT_RADOX_BASE_URL;
  const baseUrl = validateRadoxBaseUrl(rawBaseUrl);

  const rawProviderTimeout = parsePositiveInteger(
    env.ASSISTANT_PROVIDER_TIMEOUT_MS,
    "ASSISTANT_PROVIDER_TIMEOUT_MS",
  );
  const rawRequestTimeout = parsePositiveInteger(
    env.ASSISTANT_REQUEST_TIMEOUT_MS,
    "ASSISTANT_REQUEST_TIMEOUT_MS",
  );

  const providerTimeoutMs = rawProviderTimeout ?? DEFAULT_RADOX_PROVIDER_TIMEOUT_MS;
  const requestTimeoutMs = rawRequestTimeout ?? DEFAULT_RADOX_REQUEST_TIMEOUT_MS;

  if (requestTimeoutMs <= providerTimeoutMs) {
    throw new Error(
      `ASSISTANT_REQUEST_TIMEOUT_MS (${requestTimeoutMs}ms) must be strictly greater than ASSISTANT_PROVIDER_TIMEOUT_MS (${providerTimeoutMs}ms).`,
    );
  }

  const rawMaxTokens = parsePositiveInteger(
    env.ASSISTANT_RADOX_MAX_TOKENS,
    "ASSISTANT_RADOX_MAX_TOKENS",
  );

  const provider = new RadoxAssistantHelpProvider({
    baseUrl,
    apiKey,
    model,
    ...(rawMaxTokens ? { maxTokens: rawMaxTokens } : {}),
  });

  return resolveAssistantConfig({
    enabled: true,
    provider,
    providerTimeoutMs,
    requestTimeoutMs,
  });
}
