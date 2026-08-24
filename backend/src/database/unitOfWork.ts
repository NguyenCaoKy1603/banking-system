import type { PoolClient } from "pg";

import { DatabasePool } from "./pool.js";
import { withTransactionRetry, type TransactionRetryOptions } from "./transactionRetry.js";

export type TransactionContext = {
  client: PoolClient;
  query: PoolClient["query"];
  traceId?: string;
};

export type UnitOfWorkOptions = TransactionRetryOptions & {
  isolationLevel?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
  traceId?: string;
};

export type UnitOfWorkMetrics = {
  started: number;
  committed: number;
  rolledBack: number;
  retried: number;
  totalDurationMs: number;
  lastDurationMs: number;
};

/** Owns BEGIN/COMMIT/ROLLBACK and guarantees one PoolClient per callback. */
export class UnitOfWork {
  private readonly counters = {
    started: 0,
    committed: 0,
    rolledBack: 0,
    retried: 0,
    totalDurationMs: 0,
    lastDurationMs: 0,
  };

  constructor(private readonly database: DatabasePool) {}

  metrics(): UnitOfWorkMetrics {
    return { ...this.counters };
  }

  async transaction<T>(
    operation: (tx: TransactionContext) => Promise<T>,
    options: UnitOfWorkOptions = {},
  ): Promise<T> {
    const isolationLevel = options.isolationLevel ?? "READ COMMITTED";
    return withTransactionRetry(async () => {
      const startedAt = performance.now();
      this.counters.started += 1;
      const client = await this.database.connect();
      let committed = false;
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
        const result = await operation({
          client,
          query: client.query.bind(client),
          traceId: options.traceId,
        });
        await client.query("COMMIT");
        committed = true;
        this.counters.committed += 1;
        return result;
      } catch (error: unknown) {
        this.counters.rolledBack += 1;
        if (!committed) {
          await client.query("ROLLBACK").catch(() => undefined);
        }
        throw error;
      } finally {
        client.release();
        const durationMs = performance.now() - startedAt;
        this.counters.lastDurationMs = Number(durationMs.toFixed(2));
        this.counters.totalDurationMs = Number((this.counters.totalDurationMs + durationMs).toFixed(2));
      }
    }, {
      ...options,
      onRetry: (attempt, error) => {
        this.counters.retried += 1;
        options.onRetry?.(attempt, error);
      },
    });
  }
}
