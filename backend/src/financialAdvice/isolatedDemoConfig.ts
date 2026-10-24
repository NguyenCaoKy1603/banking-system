import {
  resolveAssistantConfig,
  type AssistantConfig,
} from "../assistant/helpConfig.js";
import {
  AssistantRateLimiter,
  MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN,
} from "../assistant/rateLimiter.js";
import { resolveRuntimeAssistantConfig } from "../assistant/runtimeAssistantConfig.js";
import { DomainError } from "../errors.js";
import type { HttpOptions } from "../http.js";

export type IsolatedDemoMode = "offline" | "live";

export type IsolatedDemoArguments = {
  mode: IsolatedDemoMode;
  port: number;
  webOrigin: string;
};

export type IsolatedDemoConfig = IsolatedDemoArguments & {
  host: "127.0.0.1";
  environment: "development";
  storage: "in-memory";
  assistantConfig: AssistantConfig;
  financialAdviceEnabled: true;
};

export const DEFAULT_ISOLATED_DEMO_PORT = 5010;
export const DEFAULT_ISOLATED_WEB_ORIGIN = "http://127.0.0.1:8082";
export const ISOLATED_DEMO_PROVIDER_CALLS_USED_BEFORE_WEB = 16;
export const ISOLATED_DEMO_WEB_PROVIDER_CALL_CAP = 2;

export type IsolatedDemoProviderUsage = {
  providerCallBoundaryAttempts: number;
  chargedProviderCallCount: number;
  blockedProviderCallCount: number;
  webProviderCallCap: number;
  webProviderCallsRemaining: number;
  serverRunProviderCallCount: number;
  serverRunProviderCallCap: number;
  activeSlots: number;
};

export type IsolatedDemoProviderUsageEvent = IsolatedDemoProviderUsage & {
  status: "CHARGED" | "WEB_CAP_BLOCKED" | "SERVER_CAP_BLOCKED";
};

export class IsolatedDemoAssistantRateLimiter extends AssistantRateLimiter {
  private providerCallBoundaryAttempts = 0;
  private chargedProviderCallCount = 0;
  private blockedProviderCallCount = 0;

  constructor(
    assistantConfig: AssistantConfig,
    private readonly webProviderCallCap: number,
    private readonly onProviderUsage?: (event: IsolatedDemoProviderUsageEvent) => void,
  ) {
    super(assistantConfig);
    if (!Number.isSafeInteger(webProviderCallCap) || webProviderCallCap < 0) {
      throw new Error("Isolated demo provider-call cap is invalid.");
    }
  }

  override consumeProviderCall(): void {
    this.providerCallBoundaryAttempts += 1;
    if (this.chargedProviderCallCount >= this.webProviderCallCap) {
      this.blockedProviderCallCount += 1;
      this.publishUsage("WEB_CAP_BLOCKED");
      throw new DomainError(
        503,
        "ASSISTANT_UNAVAILABLE",
        "Provider-call allowance reached for this local demo session.",
      );
    }

    try {
      super.consumeProviderCall();
    } catch (error) {
      this.blockedProviderCallCount += 1;
      this.publishUsage("SERVER_CAP_BLOCKED");
      throw error;
    }

    this.chargedProviderCallCount += 1;
    this.publishUsage("CHARGED");
  }

  getProviderUsage(): IsolatedDemoProviderUsage {
    return {
      providerCallBoundaryAttempts: this.providerCallBoundaryAttempts,
      chargedProviderCallCount: this.chargedProviderCallCount,
      blockedProviderCallCount: this.blockedProviderCallCount,
      webProviderCallCap: this.webProviderCallCap,
      webProviderCallsRemaining: Math.max(0, this.webProviderCallCap - this.chargedProviderCallCount),
      serverRunProviderCallCount: this.getProviderCallCount(),
      serverRunProviderCallCap: MAX_ASSISTANT_PROVIDER_CALLS_PER_SERVER_RUN,
      activeSlots: this.getActiveConcurrency(),
    };
  }

  private publishUsage(status: IsolatedDemoProviderUsageEvent["status"]): void {
    try {
      this.onProviderUsage?.({ ...this.getProviderUsage(), status });
    } catch {
      // Local-demo telemetry must not alter the provider or request outcome.
    }
  }
}

export function createIsolatedDemoAssistantRateLimiter(
  config: IsolatedDemoConfig,
  onProviderUsage?: (event: IsolatedDemoProviderUsageEvent) => void,
): IsolatedDemoAssistantRateLimiter {
  const webProviderCallCap = config.mode === "live" ? ISOLATED_DEMO_WEB_PROVIDER_CALL_CAP : 0;
  return new IsolatedDemoAssistantRateLimiter(config.assistantConfig, webProviderCallCap, onProviderUsage);
}

const DATABASE_ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "DATABASE_TEST_ADMIN_URL",
  "BANKING_DATABASE_URL",
  "ADMIN_DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
  "DIRECT_URL",
  "BANKING_STORAGE",
  "ADMIN_STORAGE",
  "PERSISTENCE_MODE",
  "BANKING_PERSISTENCE_MODE",
] as const;

const BANKING_SECRET_ENVIRONMENT_KEYS = [
  "REGISTRATION_FINGERPRINT_KEY",
  "BANKING_REGISTRATION_FINGERPRINT_KEY",
  "BANKING_MFA_ENCRYPTION_KEY",
  "BANKING_MFA_ENCRYPTION_KEY_ID",
  "BANKING_MFA_ENCRYPTION_KEY_PREVIOUS",
  "BANKING_MFA_ENCRYPTION_KEY_PREVIOUS_ID",
  "BANKING_OTP_DIGEST_KEY",
  "BANKING_OTP_DIGEST_KEY_ID",
  "BANKING_OTP_DIGEST_KEY_PREVIOUS",
  "BANKING_OTP_DIGEST_KEY_PREVIOUS_ID",
  "BANKING_OTP_PEPPER",
  "BANKING_OTP_PEPPER_KEY_ID",
  "BANKING_OTP_PEPPER_PREVIOUS",
  "BANKING_OTP_PEPPER_PREVIOUS_KEY_ID",
] as const;

function hasValue(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === "string" && env[key]!.trim().length > 0;
}

function assertIsolatedEnvironment(env: NodeJS.ProcessEnv, mode: IsolatedDemoMode): void {
  if (DATABASE_ENVIRONMENT_KEYS.some((key) => hasValue(env, key))) {
    throw new Error("Isolated demo refuses database or persistent-storage environment settings.");
  }
  if (Object.keys(env).some((key) => /^PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SSLMODE|OPTIONS)$/i.test(key) && hasValue(env, key))) {
    throw new Error("Isolated demo refuses PostgreSQL environment settings.");
  }
  if (BANKING_SECRET_ENVIRONMENT_KEYS.some((key) => hasValue(env, key))) {
    throw new Error("Isolated demo refuses inherited Banking System secrets.");
  }
  if (hasValue(env, "NODE_OPTIONS")) {
    throw new Error("Isolated demo refuses NODE_OPTIONS to prevent implicit preload or environment-file loading.");
  }

  const bankingEnvironment = env.BANKING_ENV?.trim().toLowerCase();
  if (bankingEnvironment && bankingEnvironment !== "development") {
    throw new Error("Isolated demo requires the local development environment.");
  }
  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnvironment && nodeEnvironment !== "development" && nodeEnvironment !== "test") {
    throw new Error("Isolated demo refuses non-local Node environments.");
  }
  if (env.BANKING_MFA_REQUIRED === "1") {
    throw new Error("Isolated demo will not override a requirement for MFA.");
  }
  if (mode === "offline" && env.ASSISTANT_ENABLED === "1") {
    throw new Error("Offline mode refuses an inherited enabled assistant configuration.");
  }
}

export function parseIsolatedDemoArguments(args: readonly string[]): IsolatedDemoArguments | null {
  if (args.length < 1 || (args[0] !== "--offline" && args[0] !== "--live")) return null;
  const mode: IsolatedDemoMode = args[0] === "--live" ? "live" : "offline";
  let port = DEFAULT_ISOLATED_DEMO_PORT;
  let webOrigin = DEFAULT_ISOLATED_WEB_ORIGIN;
  let sawPort = false;
  let sawOrigin = false;

  for (const argument of args.slice(1)) {
    const portMatch = argument.match(/^--port=(\d{1,5})$/);
    if (portMatch && !sawPort) {
      port = Number(portMatch[1]);
      sawPort = true;
      continue;
    }
    const originMatch = argument.match(/^--web-origin=(.+)$/);
    if (originMatch && !sawOrigin) {
      webOrigin = originMatch[1]!;
      sawOrigin = true;
      continue;
    }
    return null;
  }

  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  try {
    const origin = new URL(webOrigin);
    if (
      origin.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(origin.hostname) ||
      origin.username !== "" || origin.password !== "" ||
      origin.pathname !== "/" || origin.search !== "" || origin.hash !== "" ||
      origin.origin !== webOrigin.replace(/\/$/, "")
    ) return null;
  } catch {
    return null;
  }
  return { mode, port, webOrigin };
}

export function resolveIsolatedDemoConfig(
  args: IsolatedDemoArguments,
  env: NodeJS.ProcessEnv = process.env,
): IsolatedDemoConfig {
  assertIsolatedEnvironment(env, args.mode);
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) {
    throw new Error("Isolated demo port is invalid.");
  }
  const parsedOrigin = parseIsolatedDemoArguments([
    args.mode === "live" ? "--live" : "--offline",
    `--port=${args.port}`,
    `--web-origin=${args.webOrigin}`,
  ]);
  if (!parsedOrigin) throw new Error("Isolated demo Web origin must be a plain loopback HTTP origin.");

  const assistantConfig = args.mode === "live"
    ? resolveRuntimeAssistantConfig(env)
    : resolveAssistantConfig({ enabled: false });
  if (args.mode === "live" && !assistantConfig.enabled) {
    throw new Error("Live demo requires the explicitly enabled Radox AI provider.");
  }

  return {
    ...parsedOrigin,
    host: "127.0.0.1",
    environment: "development",
    storage: "in-memory",
    assistantConfig,
    financialAdviceEnabled: true,
  };
}

export function createIsolatedDemoHttpOptions(
  config: IsolatedDemoConfig,
  registrationFingerprintKey: Buffer,
  assistantRateLimiter = createIsolatedDemoAssistantRateLimiter(config),
): HttpOptions {
  return {
    allowedOrigins: [config.webOrigin],
    environment: config.environment,
    storage: config.storage,
    serviceName: "financial-advice-isolated-demo",
    assistantConfig: config.assistantConfig,
    assistantRateLimiter,
    financialAdviceConfig: { enabled: config.financialAdviceEnabled },
    registrationFingerprintKey,
  };
}

export function buildIsolatedDemoStartupMetadata(
  config: IsolatedDemoConfig,
  runId: string,
  assistantRateLimiter: IsolatedDemoAssistantRateLimiter,
) {
  const providerUsage = assistantRateLimiter.getProviderUsage();
  return {
    event: "financial-advice-demo-ready" as const,
    runId,
    host: config.host,
    port: config.port,
    webOrigin: config.webOrigin,
    storage: config.storage,
    environment: config.environment,
    assistantProviderEnabled: config.assistantConfig.enabled,
    providerTimeoutMs: config.assistantConfig.providerTimeoutMs,
    requestTimeoutMs: config.assistantConfig.requestTimeoutMs,
    providerBudget: {
      previousEvaluationCharges: ISOLATED_DEMO_PROVIDER_CALLS_USED_BEFORE_WEB,
      webProviderCallCap: providerUsage.webProviderCallCap,
      webProviderCallsRemaining: providerUsage.webProviderCallsRemaining,
      providerCallBoundaryAttempts: providerUsage.providerCallBoundaryAttempts,
      chargedProviderCallCount: providerUsage.chargedProviderCallCount,
      serverRunProviderCallCount: providerUsage.serverRunProviderCallCount,
      serverRunProviderCallCap: providerUsage.serverRunProviderCallCap,
      activeSlots: providerUsage.activeSlots,
      status: config.mode === "live" ? "READY" as const : "OFFLINE_DISABLED" as const,
    },
    loginFixture: "synthetic-in-memory-only" as const,
  };
}
