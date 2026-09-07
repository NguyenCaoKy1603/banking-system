import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalAuthService } from "../database/relationalAuthService.js";
import { hashOpaqueToken } from "../security.js";
import { DomainError } from "../errors.js";

class MockPoolClient {
  public readonly executedSql: string[] = [];
  public readonly params: unknown[][] = [];
  public committed = false;
  public rolledBack = false;

  constructor(
    private readonly queryHandler: (sql: string, params: unknown[]) => { rows: unknown[] } | Promise<{ rows: unknown[] }>,
  ) {}

  async query<R extends QueryResultRow = QueryResultRow, I = unknown[]>(
    queryTextOrConfig: string | QueryConfig<I>,
    values?: QueryConfigValues<I>,
  ): Promise<QueryResult<R>> {
    const text = typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
    const p = Array.isArray(values) ? values : [];
    this.executedSql.push(text);
    this.params.push(p);

    const trimmed = text.trim();
    if (trimmed.startsWith("BEGIN")) {
      return { rows: [] as R[], command: "BEGIN", rowCount: 0, oid: 0, fields: [] };
    }
    if (trimmed.startsWith("COMMIT")) {
      this.committed = true;
      return { rows: [] as R[], command: "COMMIT", rowCount: 0, oid: 0, fields: [] };
    }
    if (trimmed.startsWith("ROLLBACK")) {
      this.rolledBack = true;
      return { rows: [] as R[], command: "ROLLBACK", rowCount: 0, oid: 0, fields: [] };
    }

    const res = await this.queryHandler(trimmed, p);
    return {
      rows: res.rows as R[],
      command: "SELECT",
      rowCount: res.rows.length,
      oid: 0,
      fields: [],
    };
  }

  release(): void {}
}

class MockDatabasePool extends DatabasePool {
  constructor(private readonly client: PoolClient) {
    super({ connectionString: "postgresql://localhost/mock" });
  }

  override async connect(): Promise<PoolClient> {
    return this.client;
  }
}

test("RelationalAuthService.refresh: reuse detection commits revocation and rejects with 401", async () => {
  const customerId = randomUUID();
  const familyId = randomUUID();
  const deviceId = "test-device-uuid";
  const rotatedToken = "rotated-refresh-token-value";
  const rotatedHash = hashOpaqueToken(rotatedToken);

  let updatesExecuted = 0;

  const mockClient = new MockPoolClient((sql, params) => {
    // 1. Initial SELECT FOR UPDATE in refresh()
    if (sql.includes("FROM auth_sessions s") && sql.includes("FOR UPDATE")) {
      // Simulate that this token exists but was already rotated (revoked_at is set)
      return {
        rows: [
          {
            id: randomUUID(),
            customer_id: customerId,
            device_id: randomUUID(),
            family_id: familyId,
            refresh_token_hash: rotatedHash,
            revoked_at: new Date(Date.now() - 60000).toISOString(),
            refresh_expires_at: new Date(Date.now() + 600000).toISOString(),
            refresh_revoked_at: new Date(Date.now() - 60000).toISOString(),
            full_name: "Synthetic User",
            email: "user@example.test",
            phone_number: "0912345678",
            created_at: new Date().toISOString(),
            bound_device_id: deviceId,
            device_revoked_at: null,
          },
        ],
      };
    }

    // 2. Revocation UPDATE queries
    if (sql.startsWith("UPDATE auth_sessions SET revoked_at = NOW() WHERE family_id = $1")) {
      updatesExecuted += 1;
      assert.equal(params[0], familyId);
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE refresh_session_families SET revoked_at = NOW() WHERE family_id = $1")) {
      updatesExecuted += 1;
      assert.equal(params[0], familyId);
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE refresh_session_records SET revoked_at = NOW() WHERE family_id = $1")) {
      updatesExecuted += 1;
      assert.equal(params[0], familyId);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO audit_events")) {
      return { rows: [] };
    }

    return { rows: [] };
  });

  const pool = new MockDatabasePool(mockClient as unknown as PoolClient);
  const unitOfWork = new UnitOfWork(pool);
  const auth = new RelationalAuthService(unitOfWork);

  // Expect rejection with 401 Unauthorized
  let capturedError: unknown;
  try {
    await auth.refresh(rotatedToken, deviceId);
  } catch (err) {
    capturedError = err;
  }

  assert.ok(capturedError instanceof DomainError, "Must reject with DomainError");
  assert.equal(capturedError.status, 401, "Status code must be 401");
  assert.equal(capturedError.message, "Refresh token reuse detected.", "Message must match contract");
  assert.equal(updatesExecuted, 3, "All three revocation UPDATE queries must execute");

  // CRUCIAL ASSERTION: The transaction must be COMMITTED, not ROLLED BACK
  assert.equal(mockClient.committed, true, "Transaction must COMMIT revocation mutations");
  assert.equal(mockClient.rolledBack, false, "Transaction must NOT ROLLBACK revocation mutations");
  assert.equal(unitOfWork.metrics().committed, 1, "UnitOfWork metrics must record 1 commit");
  assert.equal(unitOfWork.metrics().rolledBack, 0, "UnitOfWork metrics must record 0 rollbacks");
});

test("RelationalAuthService.refresh: unexpected DB error triggers rollback and does not commit", async () => {
  const deviceId = "test-device-uuid";
  const token = "some-refresh-token";

  const mockClient = new MockPoolClient((sql) => {
    if (sql.includes("FROM auth_sessions s")) {
      throw new Error("Simulated unexpected database failure");
    }
    return { rows: [] };
  });

  const pool = new MockDatabasePool(mockClient as unknown as PoolClient);
  const unitOfWork = new UnitOfWork(pool);
  const auth = new RelationalAuthService(unitOfWork);

  await assert.rejects(
    () => auth.refresh(token, deviceId),
    /Simulated unexpected database failure/,
  );

  assert.equal(mockClient.committed, false, "Must not commit on unexpected error");
  assert.equal(mockClient.rolledBack, true, "Must rollback on unexpected error");
  assert.equal(unitOfWork.metrics().rolledBack, 1, "Metrics must record rollback");
});

test("RelationalAuthService.refresh: device mismatch rejects with 401 and rolls back without revoking family", async () => {
  const customerId = randomUUID();
  const familyId = randomUUID();
  const boundDeviceId = "device-alpha";
  const attackerDeviceId = "device-beta";
  const token = "valid-token-wrong-device";

  let updatesExecuted = 0;

  const mockClient = new MockPoolClient((sql) => {
    if (sql.includes("FROM auth_sessions s")) {
      return {
        rows: [
          {
            id: randomUUID(),
            customer_id: customerId,
            device_id: randomUUID(),
            family_id: familyId,
            refresh_token_hash: hashOpaqueToken(token),
            revoked_at: null,
            refresh_expires_at: new Date(Date.now() + 600000).toISOString(),
            refresh_revoked_at: null,
            full_name: "Synthetic User",
            email: "user@example.test",
            phone_number: "0912345678",
            created_at: new Date().toISOString(),
            bound_device_id: boundDeviceId,
            device_revoked_at: null,
          },
        ],
      };
    }
    if (sql.includes("UPDATE")) {
      updatesExecuted += 1;
    }
    return { rows: [] };
  });

  const pool = new MockDatabasePool(mockClient as unknown as PoolClient);
  const unitOfWork = new UnitOfWork(pool);
  const auth = new RelationalAuthService(unitOfWork);

  let capturedError: unknown;
  try {
    await auth.refresh(token, attackerDeviceId);
  } catch (err) {
    capturedError = err;
  }

  assert.ok(capturedError instanceof DomainError);
  assert.equal(capturedError.status, 401);
  assert.equal(capturedError.message, "Refresh token is invalid.");
  assert.equal(updatesExecuted, 0, "Must not execute any revocation updates on device mismatch");
  assert.equal(mockClient.committed, false, "Must not commit on device mismatch");
  assert.equal(mockClient.rolledBack, true, "Must rollback on device mismatch");
});
