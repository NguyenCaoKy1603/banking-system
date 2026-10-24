import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

export type DatabaseSslMode = "disable" | "require" | "verify-ca" | "verify-full";

export type DatabasePoolOptions = {
  connectionString?: string;
  max?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
  ssl?: PoolConfig["ssl"];
  sslMode?: DatabaseSslMode;
  ca?: string;
  serverName?: string;
};

export type DatabasePoolMetrics = {
  total: number;
  idle: number;
  waiting: number;
  max: number;
  queryTotal: number;
  queryErrors: number;
  slowQueries: number;
  lastSlowQueryDurationMs: number;
};

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseSslMode(value: string | undefined, fallback: DatabaseSslMode): DatabaseSslMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "disable" || normalized === "require" || normalized === "verify-ca" || normalized === "verify-full") {
    return normalized;
  }
  throw new Error("DATABASE_SSL_MODE must be disable, require, verify-ca or verify-full.");
}

function normalizeCertificate(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/\\n/g, "\n") : undefined;
}

function assertConnectionStringHasNoSslOverrides(connectionString: string): void {
  const queryIndex = connectionString.indexOf("?");
  if (queryIndex < 0) return;

  const query = connectionString.slice(queryIndex + 1).split("#", 1)[0] ?? "";
  for (const name of new URLSearchParams(query).keys()) {
    const normalized = name.toLowerCase();
    if (normalized.startsWith("ssl") || normalized === "uselibpqcompat") {
      throw new Error(
        "PostgreSQL TLS options must be configured through DATABASE_SSL_MODE and its CA/hostname settings, not DATABASE_URL query parameters.",
      );
    }
  }
}

/** Resolve node-postgres TLS options without falling back to plaintext. */
export function resolveDatabaseSslConfig(input: {
  env?: NodeJS.ProcessEnv;
  ssl?: PoolConfig["ssl"];
  sslMode?: DatabaseSslMode;
  ca?: string;
  serverName?: string;
} = {}): PoolConfig["ssl"] | undefined {
  const env = input.env ?? process.env;
  const productionLike = ["staging", "production-like"].includes(env.BANKING_ENV?.trim().toLowerCase() ?? "");
  if (input.ssl !== undefined) {
    if (productionLike) {
      const explicitSsl = input.ssl;
      if (!explicitSsl || typeof explicitSsl !== "object" || explicitSsl.rejectUnauthorized !== true) {
        throw new Error("Production-like PostgreSQL connections require an explicit TLS config with rejectUnauthorized=true.");
      }
    }
    return input.ssl;
  }
  const mode = input.sslMode ?? parseSslMode(env.DATABASE_SSL_MODE, productionLike ? "verify-full" : "disable");
  if (mode === "disable") {
    if (productionLike) {
      throw new Error("Production-like PostgreSQL connections require DATABASE_SSL_MODE=verify-full.");
    }
    return undefined;
  }

  const ca = normalizeCertificate(input.ca ?? env.DATABASE_CA_CERT);
  const servername = input.serverName?.trim() || env.DATABASE_SERVER_NAME?.trim();
  if ((mode === "verify-ca" || mode === "verify-full") && !ca) {
    throw new Error(`${mode} PostgreSQL mode requires a CA certificate from the trust store or SecretProvider.`);
  }
  if (mode === "verify-full" && !servername) {
    throw new Error("verify-full PostgreSQL mode requires DATABASE_SERVER_NAME.");
  }

  return {
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
    ...(servername ? { servername } : {}),
  };
}

function poolConfig(options: DatabasePoolOptions): PoolConfig {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for the database pool.");
  }
  assertConnectionStringHasNoSslOverrides(connectionString);

  const max = options.max ?? positiveInt(process.env.DB_POOL_MAX, 4, "DB_POOL_MAX");
  const connectionTimeoutMillis =
    options.connectionTimeoutMs ??
    positiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, 5_000, "DB_CONNECTION_TIMEOUT_MS");
  const statementTimeout =
    options.statementTimeoutMs ??
    positiveInt(process.env.DB_STATEMENT_TIMEOUT_MS, 15_000, "DB_STATEMENT_TIMEOUT_MS");
  const lockTimeout =
    options.lockTimeoutMs ??
    positiveInt(process.env.DB_LOCK_TIMEOUT_MS, 3_000, "DB_LOCK_TIMEOUT_MS");
  const idleInTransactionSessionTimeout =
    options.idleTransactionTimeoutMs ??
    positiveInt(
      process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS,
      15_000,
      "DB_IDLE_TRANSACTION_TIMEOUT_MS",
    );

  return {
    connectionString,
    max,
    connectionTimeoutMillis,
    statement_timeout: statementTimeout,
    lock_timeout: lockTimeout,
    idle_in_transaction_session_timeout: idleInTransactionSessionTimeout,
    application_name: process.env.DB_APPLICATION_NAME ?? "banking-reference-backend",
    ssl: resolveDatabaseSslConfig({
      ssl: options.ssl,
      sslMode: options.sslMode,
      ca: options.ca,
      serverName: options.serverName,
    }),
  };
}

/** One process-wide PostgreSQL pool. Repositories receive a PoolClient from UnitOfWork. */
export class DatabasePool {
  private readonly pool: Pool;
  private readonly configuredMax: number;
  private readonly slowQueryThresholdMs: number;
  private queryTotal = 0;
  private queryErrors = 0;
  private slowQueries = 0;
  private lastSlowQueryDurationMs = 0;

  constructor(options: DatabasePoolOptions = {}) {
    const config = poolConfig(options);
    this.configuredMax = config.max ?? 4;
    this.slowQueryThresholdMs = positiveInt(process.env.DB_SLOW_QUERY_THRESHOLD_MS, 250, "DB_SLOW_QUERY_THRESHOLD_MS");
    this.pool = new Pool(config);
  }

  get raw(): Pool {
    return this.pool;
  }

  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async query<T extends QueryResultRow = any>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const startedAt = performance.now();
    this.queryTotal += 1;
    try {
      return await this.pool.query<T>(text, values);
    } catch (error) {
      this.queryErrors += 1;
      throw error;
    } finally {
      const durationMs = performance.now() - startedAt;
      if (durationMs >= this.slowQueryThresholdMs) {
        this.slowQueries += 1;
        this.lastSlowQueryDurationMs = durationMs;
      }
    }
  }

  metrics(): DatabasePoolMetrics {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      max: this.configuredMax,
      queryTotal: this.queryTotal,
      queryErrors: this.queryErrors,
      slowQueries: this.slowQueries,
      lastSlowQueryDurationMs: this.lastSlowQueryDurationMs,
    };
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
