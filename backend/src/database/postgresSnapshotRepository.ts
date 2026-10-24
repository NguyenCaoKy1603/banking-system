import { Pool, type PoolClient } from "pg";

import { resolveDatabaseSslConfig } from "./pool.js";

export type SnapshotOperation<T> = (state: unknown) => Promise<{
  result: T;
  nextState: unknown;
}>;

export type PostgresSnapshotRepositoryOptions = {
  connectionString?: string;
  snapshotKey?: string;
  maxConnections?: number;
};

export class PostgresSnapshotRepository {
  private readonly pool: Pool;
  private readonly snapshotKey: string;

  constructor(options: PostgresSnapshotRepositoryOptions = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString?.trim()) {
      throw new Error("DATABASE_URL is required for the PostgreSQL persistent adapter.");
    }

    this.snapshotKey = options.snapshotKey ?? process.env.BANKING_SNAPSHOT_KEY ?? "banking-reference-sandbox";
    this.pool = new Pool({
      connectionString,
      max: options.maxConnections ?? 4,
      ssl: resolveDatabaseSslConfig(),
    });
  }

  async initialize(): Promise<void> {
    const result = await this.pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.reference_state_snapshots') AS table_name",
    );
    if (!result.rows[0]?.table_name) {
      throw new Error(
        "PostgreSQL schema is not initialized. Run `npm run db:migrate` before starting the persistent backend.",
      );
    }
  }

  async withState<T>(initialState: unknown, operation: SnapshotOperation<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockSnapshot(client);
      const current = await this.readState(client, initialState);
      const { result, nextState } = await operation(current);
      await this.writeState(client, nextState);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async deleteSnapshot(): Promise<void> {
    await this.pool.query(
      "DELETE FROM reference_state_snapshots WHERE snapshot_key = $1",
      [this.snapshotKey],
    );
  }

  private async lockSnapshot(client: PoolClient): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      this.snapshotKey,
    ]);
  }

  private async readState(client: PoolClient, initialState: unknown): Promise<unknown> {
    const result = await client.query<{ state: unknown }>(
      "SELECT state FROM reference_state_snapshots WHERE snapshot_key = $1 FOR UPDATE",
      [this.snapshotKey],
    );
    return result.rows[0]?.state ?? initialState;
  }

  private async writeState(client: PoolClient, nextState: unknown): Promise<void> {
    await client.query(
      `
        INSERT INTO reference_state_snapshots (snapshot_key, state, version, updated_at)
        VALUES ($1, $2::jsonb, 1, NOW())
        ON CONFLICT (snapshot_key)
        DO UPDATE SET
          state = EXCLUDED.state,
          version = reference_state_snapshots.version + 1,
          updated_at = EXCLUDED.updated_at
      `,
      [this.snapshotKey, JSON.stringify(nextState)],
    );
  }
}
