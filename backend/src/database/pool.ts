import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

export type DatabasePoolOptions = {
  connectionString?: string;
  max?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
};

export type DatabasePoolMetrics = {
  total: number;
  idle: number;
  waiting: number;
  max: number;
};

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function poolConfig(options: DatabasePoolOptions): PoolConfig {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for the database pool.");
  }

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
  };
}

/** One process-wide PostgreSQL pool. Repositories receive a PoolClient from UnitOfWork. */
export class DatabasePool {
  private readonly pool: Pool;
  private readonly configuredMax: number;

  constructor(options: DatabasePoolOptions = {}) {
    const config = poolConfig(options);
    this.configuredMax = config.max ?? 4;
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
    return this.pool.query<T>(text, values);
  }

  metrics(): DatabasePoolMetrics {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      max: this.configuredMax,
    };
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
