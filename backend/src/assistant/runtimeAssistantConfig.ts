import { type AssistantConfig, resolveAssistantConfig } from "./helpConfig.js";
import {
  DEFAULT_OLLAMA_BASE_URL,
  OllamaAssistantHelpProvider,
  validateOllamaBaseUrl,
  validateOllamaModel,
} from "./ollamaHelpProvider.js";

export const DEFAULT_OLLAMA_PROVIDER_TIMEOUT_MS = 25_000;
export const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 30_000;

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
 *   ASSISTANT_OLLAMA_BASE_URL, ASSISTANT_PROVIDER_TIMEOUT_MS, and ASSISTANT_REQUEST_TIMEOUT_MS.
 * - Enforces that ASSISTANT_REQUEST_TIMEOUT_MS > ASSISTANT_PROVIDER_TIMEOUT_MS.
 *   Any missing or invalid configuration throws an error.
 *   Never falls back to FakeProvider or remote cloud providers.
 */
export function resolveRuntimeAssistantConfig(
  env: NodeJS.ProcessEnv = process.env,
): AssistantConfig {
  const isEnabled = env.ASSISTANT_ENABLED === "1";
  if (!isEnabled) {
    return resolveAssistantConfig({ enabled: false });
  }

  const providerType = env.ASSISTANT_PROVIDER?.trim().toLowerCase();
  if (providerType !== "ollama") {
    throw new Error(
      `ASSISTANT_PROVIDER must be 'ollama' when ASSISTANT_ENABLED=1; received '${env.ASSISTANT_PROVIDER ?? "empty"}'.`,
    );
  }

  const rawModel = env.ASSISTANT_MODEL?.trim();
  if (!rawModel) {
    throw new Error("ASSISTANT_MODEL is required when ASSISTANT_ENABLED=1.");
  }
  const model = validateOllamaModel(rawModel);

  const rawBaseUrl = env.ASSISTANT_OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const baseUrl = validateOllamaBaseUrl(rawBaseUrl);

  const rawProviderTimeout = parsePositiveInteger(
    env.ASSISTANT_PROVIDER_TIMEOUT_MS,
    "ASSISTANT_PROVIDER_TIMEOUT_MS",
  );
  const rawRequestTimeout = parsePositiveInteger(
    env.ASSISTANT_REQUEST_TIMEOUT_MS,
    "ASSISTANT_REQUEST_TIMEOUT_MS",
  );

  const providerTimeoutMs = rawProviderTimeout ?? DEFAULT_OLLAMA_PROVIDER_TIMEOUT_MS;
  const requestTimeoutMs = rawRequestTimeout ?? DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS;

  if (requestTimeoutMs <= providerTimeoutMs) {
    throw new Error(
      `ASSISTANT_REQUEST_TIMEOUT_MS (${requestTimeoutMs}ms) must be strictly greater than ASSISTANT_PROVIDER_TIMEOUT_MS (${providerTimeoutMs}ms).`,
    );
  }

  const rawNumPredict = parsePositiveInteger(
    env.ASSISTANT_OLLAMA_NUM_PREDICT,
    "ASSISTANT_OLLAMA_NUM_PREDICT",
  );

  const provider = new OllamaAssistantHelpProvider({
    baseUrl,
    model,
    ...(rawNumPredict ? { numPredict: rawNumPredict } : {}),
  });

  return resolveAssistantConfig({
    enabled: true,
    provider,
    providerTimeoutMs,
    requestTimeoutMs,
  });
}
