import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalAuthService } from "../database/relationalAuthService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { hashOpaqueToken, hashPasswordAsync } from "../security.js";
import { DomainError } from "../errors.js";

const databaseUrl = process.env.RELATIONAL_DATABASE_URL?.trim();
if (databaseUrl) {
  assertDisposableDatabaseResetAllowed(databaseUrl, process.env, {
    targetEnvName: "RELATIONAL_DATABASE_URL",
  });
}

function generateVietnamesePhone(): string {
  const suffix = Math.floor(10000000 + Math.random() * 90000000).toString();
  return `09${suffix}`;
}

async function createCustomer(
  db: DatabasePool,
  overrides?: { id?: string; fullName?: string; email?: string; phoneNumber?: string },
): Promise<{ id: string; fullName: string; email: string; phoneNumber: string }> {
  const id = overrides?.id ?? randomUUID();
  const fullName = overrides?.fullName ?? "Synthetic Auth User";
  const email = overrides?.email ?? `auth-test-${randomUUID()}@example.test`;
  const phoneNumber = overrides?.phoneNumber ?? generateVietnamesePhone();
  await db.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, $2, $3, $4, 'fixture_salt', 'fixture_digest', NOW())`,
    [id, fullName, email, phoneNumber],
  );
  return { id, fullName, email, phoneNumber };
}

test("relational auth suite: refresh rotation, reuse revocation persistence and pre-existing session isolation", { skip: !databaseUrl }, async (t) => {
  let pool: DatabasePool | null = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  const database = pool;
  const unitOfWork = new UnitOfWork(database);
  const auth = new RelationalAuthService(unitOfWork);

  // -------------------------------------------------------------------------
  // 1. Setup: Customer with TWO distinct active families (Family A and Family B)
  // -------------------------------------------------------------------------
  const customer = await createCustomer(database);
  const deviceA = `device-a-${randomUUID()}`;
  const deviceB = `device-b-${randomUUID()}`;

  // Issue Session for Device A (Family A, token R0)
  const sessionA0 = await auth.issueSession(customer.id, deviceA);
  const hasTokenA0 = typeof sessionA0.refreshToken === "string" && sessionA0.refreshToken.length > 0;
  assert.equal(hasTokenA0, true, "Initial token R0 for Family A must be issued");

  // Rotate R0 -> R1 on Device A
  const sessionA1 = await auth.refresh(sessionA0.refreshToken, deviceA);
  const hasTokenA1 = typeof sessionA1.refreshToken === "string" && sessionA1.refreshToken.length > 0;
  const isDistinctTokenA = hasTokenA1 && sessionA1.refreshToken !== sessionA0.refreshToken;
  assert.equal(isDistinctTokenA, true, "Rotated token R1 must be distinct from R0");

  // Authenticate on Device A with sessionA1 access token
  const authA1Ok = await auth.authenticate(sessionA1.accessToken, deviceA).then(
    (u) => u.id === customer.id,
    () => false,
  );
  assert.equal(authA1Ok, true, "Session A1 access token must authenticate before replay");

  // CRITICAL REQUIREMENT: Create Family B for same customer BEFORE replaying token of Family A
  const sessionB0 = await auth.issueSession(customer.id, deviceB);
  const hasTokenB0 = typeof sessionB0.refreshToken === "string" && sessionB0.refreshToken.length > 0;
  assert.equal(hasTokenB0, true, "Pre-existing token for Family B must be issued before Family A replay");

  const authB0Ok = await auth.authenticate(sessionB0.accessToken, deviceB).then(
    (u) => u.id === customer.id,
    () => false,
  );
  assert.equal(authB0Ok, true, "Family B session must be active before Family A replay");

  // Identify family IDs via hashes to query DB state safely
  const familyAResult = await database.query<{ family_id: string }>(
    `SELECT family_id FROM auth_sessions WHERE access_token_hash = $1`,
    [hashOpaqueToken(sessionA0.accessToken)],
  );
  const familyBResult = await database.query<{ family_id: string }>(
    `SELECT family_id FROM auth_sessions WHERE access_token_hash = $1`,
    [hashOpaqueToken(sessionB0.accessToken)],
  );
  assert.equal(familyAResult.rows.length > 0, true, "Must find Family A record");
  assert.equal(familyBResult.rows.length > 0, true, "Must find Family B record");
  const familyAId = familyAResult.rows[0]?.family_id;
  const familyBId = familyBResult.rows[0]?.family_id;
  assert.equal(familyAId !== familyBId, true, "Family A and Family B must have distinct family IDs");

  // -------------------------------------------------------------------------
  // 2. Replay rotated token R0 of Family A (Reuse detection)
  // -------------------------------------------------------------------------
  let reuseStatus: number | undefined;
  let reuseMessage: string | undefined;
  try {
    await auth.refresh(sessionA0.refreshToken, deviceA);
  } catch (err) {
    if (err instanceof DomainError) {
      reuseStatus = err.status;
      reuseMessage = err.message;
    }
  }
  assert.equal(reuseStatus, 401, "Replay of rotated token R0 must return HTTP 401");
  assert.equal(reuseMessage, "Refresh token reuse detected.", "Must return expected reuse message");

  // -------------------------------------------------------------------------
  // 3. Verify Family A is persisted as revoked in PostgreSQL
  // -------------------------------------------------------------------------
  const familyARow = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE family_id = $1`,
    [familyAId],
  );
  const familyAPersistedRevoked = familyARow.rows[0]?.revoked_at !== null && familyARow.rows[0]?.revoked_at !== undefined;
  assert.equal(familyAPersistedRevoked, true, "CRITICAL: Family A must be committed as revoked in PostgreSQL");

  const activeSessionsA = await database.query(
    `SELECT id FROM auth_sessions WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyAId],
  );
  assert.equal(activeSessionsA.rows.length, 0, "All sessions in Family A must be revoked");

  const activeRecordsA = await database.query(
    `SELECT session_key FROM refresh_session_records WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyAId],
  );
  assert.equal(activeRecordsA.rows.length, 0, "All refresh records in Family A must be revoked");

  // Verify subsequent operations on Family A fail safely
  const subsequentRefreshAFailed = await auth.refresh(sessionA1.refreshToken, deviceA).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );
  assert.equal(subsequentRefreshAFailed, true, "Subsequent refresh with R1 must fail with 401");

  const authA1AfterRevokeFailed = await auth.authenticate(sessionA1.accessToken, deviceA).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );
  assert.equal(authA1AfterRevokeFailed, true, "Access token of revoked Family A must fail with 401");

  // -------------------------------------------------------------------------
  // 4. Verify pre-existing Family B remains completely valid and usable
  // -------------------------------------------------------------------------
  const familyBRow = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE family_id = $1`,
    [familyBId],
  );
  const familyBStillUnrevoked = familyBRow.rows[0]?.revoked_at === null;
  assert.equal(familyBStillUnrevoked, true, "Pre-existing Family B must NOT be revoked by Family A reuse");

  // Pre-existing Family B can still authenticate
  const authBStillValid = await auth.authenticate(sessionB0.accessToken, deviceB).then(
    (u) => u.id === customer.id,
    () => false,
  );
  assert.equal(authBStillValid, true, "Pre-existing Family B access token must authenticate after Family A reuse");

  // Pre-existing Family B can still refresh/rotate
  let sessionB1RefreshToken: string | undefined;
  let sessionB1AccessToken: string | undefined;
  const refreshBOk = await auth.refresh(sessionB0.refreshToken, deviceB).then(
    (res) => {
      sessionB1RefreshToken = res.refreshToken;
      sessionB1AccessToken = res.accessToken;
      return typeof res.accessToken === "string" && typeof res.refreshToken === "string";
    },
    () => false,
  );
  assert.equal(refreshBOk, true, "Pre-existing Family B must refresh successfully after Family A reuse");

  // -------------------------------------------------------------------------
  // 5. Device mismatch: wrong device does not revoke valid family
  // -------------------------------------------------------------------------
  let wrongDeviceStatus: number | undefined;
  let wrongDeviceMessage: string | undefined;
  try {
    // Present Device B's new refresh token with Device A's header
    await auth.refresh(sessionB1RefreshToken!, deviceA);
  } catch (err) {
    if (err instanceof DomainError) {
      wrongDeviceStatus = err.status;
      wrongDeviceMessage = err.message;
    }
  }
  assert.equal(wrongDeviceStatus, 401, "Mismatched device must return 401");
  assert.equal(wrongDeviceMessage, "Refresh token is invalid.", "Mismatched device must return expected message");

  // Device B remains valid after mismatched device attempt
  const deviceBStillActive = await auth.authenticate(sessionB1AccessToken!, deviceB).then(
    (u) => u.id === customer.id,
    () => false,
  );
  assert.equal(deviceBStillActive, true, "Device B must remain active after mismatched device attempt");
});

test("relational auth suite: logout current device, relational persistence, and pre-existing session isolation (Matrix A & C)", { skip: !databaseUrl }, async (t) => {
  let pool: DatabasePool | null = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  const database = pool;
  const unitOfWork = new UnitOfWork(database);
  const auth = new RelationalAuthService(unitOfWork);

  // -------------------------------------------------------------------------
  // 1. Setup: Customer U with 2 active families (Family A and Family B)
  // -------------------------------------------------------------------------
  const customerU = await createCustomer(database);
  const deviceA = `device-a-${randomUUID()}`;
  const deviceB = `device-b-${randomUUID()}`;

  const sessionA0 = await auth.issueSession(customerU.id, deviceA);
  const sessionB0 = await auth.issueSession(customerU.id, deviceB);

  const authA0Before = await auth.authenticate(sessionA0.accessToken, deviceA).then(
    (u) => u.id === customerU.id,
    () => false,
  );
  const authB0Before = await auth.authenticate(sessionB0.accessToken, deviceB).then(
    (u) => u.id === customerU.id,
    () => false,
  );
  assert.equal(authA0Before, true, "Session A must be active before revoke");
  assert.equal(authB0Before, true, "Session B must be active before revoke");

  const familyAResult = await database.query<{ family_id: string }>(
    `SELECT family_id FROM auth_sessions WHERE access_token_hash = $1`,
    [hashOpaqueToken(sessionA0.accessToken)],
  );
  const familyBResult = await database.query<{ family_id: string }>(
    `SELECT family_id FROM auth_sessions WHERE access_token_hash = $1`,
    [hashOpaqueToken(sessionB0.accessToken)],
  );
  const familyAId = familyAResult.rows[0]?.family_id;
  const familyBId = familyBResult.rows[0]?.family_id;
  assert.ok(familyAId && familyBId);
  assert.notEqual(familyAId, familyBId, "Family A and B must be distinct");

  // -------------------------------------------------------------------------
  // 2. Boundary checks before valid revoke (Matrix C1, C2)
  // -------------------------------------------------------------------------
  // C1: Mismatched device id does not revoke
  const wrongDeviceRevoke = await auth.revoke(sessionA0.refreshToken, deviceB);
  assert.equal(wrongDeviceRevoke, false, "Revoke with mismatched device must return false");

  // C2: Non-existent token does not revoke
  const unknownTokenRevoke = await auth.revoke(`unknown-token-${randomUUID()}`, deviceA);
  assert.equal(unknownTokenRevoke, false, "Revoke with unknown token must return false");

  // Confirm Family A is still active after boundary attempts
  const authA0StillActive = await auth.authenticate(sessionA0.accessToken, deviceA).then(
    (u) => u.id === customerU.id,
    () => false,
  );
  assert.equal(authA0StillActive, true, "Family A must remain active after failed boundary revoke attempts");

  // -------------------------------------------------------------------------
  // 3. Action: Revoke Family A (Matrix A)
  // -------------------------------------------------------------------------
  const revokedA = await auth.revoke(sessionA0.refreshToken, deviceA);
  assert.equal(revokedA, true, "auth.revoke must return true for valid token and device");

  // -------------------------------------------------------------------------
  // 4. Verify persisted state in PostgreSQL via independent queries
  // -------------------------------------------------------------------------
  const authSessionsARows = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM auth_sessions WHERE family_id = $1`,
    [familyAId],
  );
  const familyARows = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE family_id = $1`,
    [familyAId],
  );
  const refreshRecordsARows = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_records WHERE family_id = $1`,
    [familyAId],
  );

  const authSessionsAPersistedRevoked = authSessionsARows.rows.length > 0 && authSessionsARows.rows.every((r) => r.revoked_at !== null);
  const familyAPersistedRevoked = familyARows.rows.length > 0 && familyARows.rows.every((r) => r.revoked_at !== null);
  const refreshRecordsAPersistedRevoked = refreshRecordsARows.rows.length > 0 && refreshRecordsARows.rows.every((r) => r.revoked_at !== null);

  assert.equal(authSessionsAPersistedRevoked, true, "All auth_sessions for Family A must have revoked_at IS NOT NULL");
  assert.equal(familyAPersistedRevoked, true, "refresh_session_families for Family A must have revoked_at IS NOT NULL");
  assert.equal(refreshRecordsAPersistedRevoked, true, "refresh_session_records for Family A must have revoked_at IS NOT NULL");

  // Audit event check
  const auditEventARows = await database.query<{ event_type: string; actor_customer_id: string; resource_id: string }>(
    `SELECT event_type, actor_customer_id, resource_id FROM audit_events WHERE actor_customer_id = $1 AND resource_id = $2`,
    [customerU.id, familyAId],
  );
  const hasAuditSessionRevoked = auditEventARows.rows.some((e) => e.event_type === "SESSION_REVOKED");
  assert.equal(hasAuditSessionRevoked, true, "Audit event SESSION_REVOKED must be persisted with correct actor and resource");

  // -------------------------------------------------------------------------
  // 5. Invalidation of Family A tokens
  // -------------------------------------------------------------------------
  const authAAfterRevoke = await auth.authenticate(sessionA0.accessToken, deviceA).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );
  assert.equal(authAAfterRevoke, true, "Access token of revoked Family A must be rejected with 401");

  const refreshAAfterRevoke = await auth.refresh(sessionA0.refreshToken, deviceA).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );
  assert.equal(refreshAAfterRevoke, true, "Refresh token of revoked Family A must be rejected with 401");

  // -------------------------------------------------------------------------
  // 6. Pre-existing Family B remains completely active and unrevoked
  // -------------------------------------------------------------------------
  const familyBRows = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE family_id = $1`,
    [familyBId],
  );
  const familyBStillUnrevoked = familyBRows.rows[0]?.revoked_at === null;
  assert.equal(familyBStillUnrevoked, true, "Pre-existing Family B must NOT be revoked by Family A logout");

  const authBStillActive = await auth.authenticate(sessionB0.accessToken, deviceB).then(
    (u) => u.id === customerU.id,
    () => false,
  );
  assert.equal(authBStillActive, true, "Family B access token must still authenticate");

  const refreshBStillWorks = await auth.refresh(sessionB0.refreshToken, deviceB).then(
    (res) => typeof res.accessToken === "string" && typeof res.refreshToken === "string",
    () => false,
  );
  assert.equal(refreshBStillWorks, true, "Family B refresh token must still rotate and issue new tokens");

  // -------------------------------------------------------------------------
  // 7. Repeated current logout (Matrix C3: Idempotency)
  // -------------------------------------------------------------------------
  const repeatedRevokeA = await auth.revoke(sessionA0.refreshToken, deviceA);
  assert.equal(repeatedRevokeA, true, "Repeated revoke with already revoked token must return true");

  const familyAAfterRepeated = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE family_id = $1`,
    [familyAId],
  );
  assert.ok(familyAAfterRepeated.rows[0]?.revoked_at !== null, "Family A must stay revoked");
});

test("relational auth suite: logout all sessions, cross-customer isolation, and bearer boundary (Matrix B & C)", { skip: !databaseUrl }, async (t) => {
  let pool: DatabasePool | null = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  const database = pool;
  const unitOfWork = new UnitOfWork(database);
  const auth = new RelationalAuthService(unitOfWork);

  // -------------------------------------------------------------------------
  // 1. Setup: Customer U (Family A on Device A, Family B on Device B)
  //           Customer V (Family C on Device C)
  // -------------------------------------------------------------------------
  const customerU = await createCustomer(database);
  const customerV = await createCustomer(database);

  const deviceUA = `device-ua-${randomUUID()}`;
  const deviceUB = `device-ub-${randomUUID()}`;
  const deviceVC = `device-vc-${randomUUID()}`;

  const sessionUA = await auth.issueSession(customerU.id, deviceUA);
  const sessionUB = await auth.issueSession(customerU.id, deviceUB);
  const sessionVC = await auth.issueSession(customerV.id, deviceVC);

  const authUA = await auth.authenticate(sessionUA.accessToken, deviceUA).then((u) => u.id === customerU.id, () => false);
  const authUB = await auth.authenticate(sessionUB.accessToken, deviceUB).then((u) => u.id === customerU.id, () => false);
  const authVC = await auth.authenticate(sessionVC.accessToken, deviceVC).then((u) => u.id === customerV.id, () => false);
  assert.equal(authUA, true, "Customer U session A must be active");
  assert.equal(authUB, true, "Customer U session B must be active");
  assert.equal(authVC, true, "Customer V session C must be active");

  // -------------------------------------------------------------------------
  // 2. Action: Revoke all sessions of Customer U (Matrix B)
  // -------------------------------------------------------------------------
  await auth.revokeAllSessions(customerU.id);

  // -------------------------------------------------------------------------
  // 3. Verify Customer U sessions are persisted as revoked in PostgreSQL
  // -------------------------------------------------------------------------
  const uSessions = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM auth_sessions WHERE customer_id = $1`,
    [customerU.id],
  );
  const uFamilies = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE customer_id = $1`,
    [customerU.id],
  );
  const uRecords = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_records WHERE customer_id = $1`,
    [customerU.id],
  );

  const uSessionsAllRevoked = uSessions.rows.length >= 2 && uSessions.rows.every((r) => r.revoked_at !== null);
  const uFamiliesAllRevoked = uFamilies.rows.length >= 2 && uFamilies.rows.every((r) => r.revoked_at !== null);
  const uRecordsAllRevoked = uRecords.rows.length >= 2 && uRecords.rows.every((r) => r.revoked_at !== null);

  assert.equal(uSessionsAllRevoked, true, "All auth_sessions of Customer U must be revoked");
  assert.equal(uFamiliesAllRevoked, true, "All refresh_session_families of Customer U must be revoked");
  assert.equal(uRecordsAllRevoked, true, "All refresh_session_records of Customer U must be revoked");

  // Audit event check
  const auditU = await database.query<{ event_type: string; actor_customer_id: string }>(
    `SELECT event_type, actor_customer_id FROM audit_events WHERE actor_customer_id = $1 AND event_type = 'ALL_SESSIONS_REVOKED'`,
    [customerU.id],
  );
  assert.ok(auditU.rows.length > 0, "Audit event ALL_SESSIONS_REVOKED must be persisted for Customer U");

  // -------------------------------------------------------------------------
  // 4. Invalidation of Customer U tokens (Matrix B)
  // -------------------------------------------------------------------------
  const authUAAfter = await auth.authenticate(sessionUA.accessToken, deviceUA).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );
  const authUBAfter = await auth.authenticate(sessionUB.accessToken, deviceUB).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );
  const refreshUAAfter = await auth.refresh(sessionUA.refreshToken, deviceUA).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );
  const refreshUBAfter = await auth.refresh(sessionUB.refreshToken, deviceUB).then(
    () => false,
    (err) => err instanceof DomainError && err.status === 401,
  );

  assert.equal(authUAAfter, true, "Access token of Customer U Device A must be rejected with 401");
  assert.equal(authUBAfter, true, "Access token of Customer U Device B must be rejected with 401");
  assert.equal(refreshUAAfter, true, "Refresh token of Customer U Device A must be rejected with 401");
  assert.equal(refreshUBAfter, true, "Refresh token of Customer U Device B must be rejected with 401");

  // -------------------------------------------------------------------------
  // 5. Cross-Customer Isolation: Customer V sessions remain active (Matrix B)
  // -------------------------------------------------------------------------
  const vFamilies = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE customer_id = $1`,
    [customerV.id],
  );
  const vFamiliesUnrevoked = vFamilies.rows.length > 0 && vFamilies.rows.every((r) => r.revoked_at === null);
  assert.equal(vFamiliesUnrevoked, true, "Customer V families must remain completely unrevoked");

  const authVCAfter = await auth.authenticate(sessionVC.accessToken, deviceVC).then(
    (u) => u.id === customerV.id,
    () => false,
  );
  assert.equal(authVCAfter, true, "Customer V must still authenticate successfully");

  const refreshVCWorks = await auth.refresh(sessionVC.refreshToken, deviceVC).then(
    (res) => typeof res.accessToken === "string" && typeof res.refreshToken === "string",
    () => false,
  );
  assert.equal(refreshVCWorks, true, "Customer V must still refresh successfully");

  // -------------------------------------------------------------------------
  // 6. Bearer Boundary: Revoked bearer token rejected on subsequent auth (Matrix C4)
  // -------------------------------------------------------------------------
  // Once Customer U's session is revoked, presenting that bearer token fails authentication
  // ensuring that repeated logout-all with the same revoked bearer is rejected with 401
  const bearerRevokedStatus = await auth.authenticate(sessionUA.accessToken, deviceUA).then(
    () => undefined,
    (err) => (err instanceof DomainError ? err.status : undefined),
  );
  assert.equal(bearerRevokedStatus, 401, "Revoked bearer token cannot pass authentication (HTTP 401)");
});

class MockAuthPoolClient {
  public readonly executedSql: string[] = [];
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
    const params = Array.isArray(values) ? values : [];
    this.executedSql.push(text);
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
    const res = await this.queryHandler(trimmed, params);
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

class MockAuthDatabasePool extends DatabasePool {
  constructor(private readonly client: PoolClient) {
    super({ connectionString: "postgresql://localhost/mock" });
  }

  override async connect(): Promise<PoolClient> {
    return this.client;
  }
}

test("RelationalAuthService access_status guard: blocks LOCKED customers in login, issueSession, authenticate, and refresh", async () => {
  const customerId = randomUUID();
  const familyId = randomUUID();
  const deviceId = "device-lock-guard";
  const email = "locked-user@example.test";
  const password = await hashPasswordAsync("StrongPassword!123");
  let accessStatus: "ACTIVE" | "LOCKED" = "ACTIVE";
  const revokedUpdates: string[] = [];

  const mockClient = new MockAuthPoolClient((sql, params) => {
    if (sql.includes("INSERT INTO rate_limit_buckets")) {
      return { rows: [] };
    }
    if (sql.includes("FROM rate_limit_buckets")) {
      const keys = params[0] as string[];
      return {
        rows: keys.map((bucketKey) => ({
          bucket_key: bucketKey,
          blocked_until: null,
          attempts: 0,
          retry_after: 600,
        })),
      };
    }
    if (sql.includes("UPDATE rate_limit_buckets") && sql.includes("RETURNING")) {
      return { rows: [{ attempts: 1, retry_after: 600 }] };
    }
    if (sql.includes("UPDATE rate_limit_buckets")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM customers WHERE lower(email) = lower($1)")) {
      return {
        rows: [
          {
            id: customerId,
            full_name: "Locked Customer",
            email,
            phone_number: "0900000001",
            password_salt: password.salt,
            password_digest: password.digest,
            access_status: accessStatus,
            created_at: new Date().toISOString(),
          },
        ],
      };
    }
    if (sql.includes("SELECT * FROM customers WHERE id = $1")) {
      return {
        rows: [
          {
            id: customerId,
            full_name: "Locked Customer",
            email,
            phone_number: "0900000001",
            password_salt: password.salt,
            password_digest: password.digest,
            access_status: accessStatus,
            created_at: new Date().toISOString(),
          },
        ],
      };
    }
    if (sql.includes("FROM auth_sessions s") && sql.includes("s.access_token_hash = $1")) {
      return {
        rows: [
          {
            id: customerId,
            full_name: "Locked Customer",
            email,
            phone_number: "0900000001",
            access_status: accessStatus,
            created_at: new Date().toISOString(),
          },
        ],
      };
    }
    if (sql.includes("FROM auth_sessions s") && sql.includes("FOR UPDATE")) {
      return {
        rows: [
          {
            id: randomUUID(),
            customer_id: customerId,
            device_id: randomUUID(),
            family_id: familyId,
            refresh_token_hash: hashOpaqueToken("valid-refresh-token"),
            revoked_at: null,
            refresh_expires_at: new Date(Date.now() + 600_000).toISOString(),
            refresh_revoked_at: null,
            full_name: "Locked Customer",
            email,
            phone_number: "0900000001",
            access_status: accessStatus,
            created_at: new Date().toISOString(),
            bound_device_id: deviceId,
            device_revoked_at: null,
          },
        ],
      };
    }
    if (sql.includes("SET revoked_at = NOW() WHERE family_id = $1")) {
      revokedUpdates.push(sql);
      return { rows: [] };
    }
    return { rows: [] };
  });

  const auth = new RelationalAuthService(new UnitOfWork(new MockAuthDatabasePool(mockClient as unknown as PoolClient)));

  // ACTIVE customer can login and authenticate
  const activeLogin = await auth.loginPasswordOnly(email, "StrongPassword!123", deviceId);
  assert.equal(activeLogin.id, customerId);
  const activeAuth = await auth.authenticate("valid-access-token", deviceId);
  assert.equal(activeAuth.id, customerId);

  // Switch customer to LOCKED
  accessStatus = "LOCKED";

  // Wrong password while LOCKED must still return 401 (no account-status oracle leak)
  await assert.rejects(
    () => auth.loginPasswordOnly(email, "WrongPassword!123", deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 401 && err.code === "UNAUTHORIZED",
  );

  // Valid password while LOCKED must reject with 403 CUSTOMER_ACCESS_LOCKED
  await assert.rejects(
    () => auth.loginPasswordOnly(email, "StrongPassword!123", deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === "CUSTOMER_ACCESS_LOCKED",
  );

  // issueSession while LOCKED must reject with 403 CUSTOMER_ACCESS_LOCKED
  await assert.rejects(
    () => auth.issueSession(customerId, deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === "CUSTOMER_ACCESS_LOCKED",
  );

  // Existing accessToken while LOCKED must reject with 403 CUSTOMER_ACCESS_LOCKED
  await assert.rejects(
    () => auth.authenticate("valid-access-token", deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === "CUSTOMER_ACCESS_LOCKED",
  );

  // Existing refreshToken while LOCKED must revoke session family, commit, and reject with 403 CUSTOMER_ACCESS_LOCKED
  mockClient.committed = false;
  mockClient.rolledBack = false;
  await assert.rejects(
    () => auth.refresh("valid-refresh-token", deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === "CUSTOMER_ACCESS_LOCKED",
  );
  assert.equal(revokedUpdates.length, 3, "All 3 session tables must be revoked when refreshing a locked customer");
  assert.equal(mockClient.committed, true, "Session revocation for locked customer refresh must be committed");
  assert.equal(mockClient.rolledBack, false);
});

test("relational auth suite: LOCKED customer access_status blocks login, bearer authenticate, and refresh on PostgreSQL", { skip: !databaseUrl }, async (t) => {
  let pool: DatabasePool | null = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => {
    if (pool) {
      await pool.close();
      pool = null;
    }
  });

  const database = pool;
  const auth = new RelationalAuthService(new UnitOfWork(database));
  const customerId = randomUUID();
  const email = `locked-pg-${customerId}@example.test`;
  const phoneNumber = generateVietnamesePhone();
  const password = await hashPasswordAsync("StrongPassword!123");
  const deviceId = `device-pg-lock-${randomUUID()}`;

  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, access_status, access_version, created_at)
     VALUES ($1, 'PG Lock Test User', $2, $3, $4, $5, 'ACTIVE', 1, NOW())`,
    [customerId, email, phoneNumber, password.salt, password.digest],
  );

  const loginUser = await auth.loginPasswordOnly(email, "StrongPassword!123", deviceId);
  assert.equal(loginUser.id, customerId);

  const session = await auth.issueSession(customerId, deviceId);
  const authenticated = await auth.authenticate(session.accessToken, deviceId);
  assert.equal(authenticated.id, customerId);

  // Lock customer in PostgreSQL
  await database.query(`UPDATE customers SET access_status = 'LOCKED', access_version = access_version + 1 WHERE id = $1`, [customerId]);

  await assert.rejects(
    () => auth.loginPasswordOnly(email, "StrongPassword!123", deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === "CUSTOMER_ACCESS_LOCKED",
  );

  await assert.rejects(
    () => auth.authenticate(session.accessToken, deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === "CUSTOMER_ACCESS_LOCKED",
  );

  await assert.rejects(
    () => auth.refresh(session.refreshToken, deviceId),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === "CUSTOMER_ACCESS_LOCKED",
  );

  const revokedFamilies = await database.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM refresh_session_families WHERE customer_id = $1`,
    [customerId],
  );
  assert.ok(revokedFamilies.rows.length > 0 && revokedFamilies.rows.every((row) => row.revoked_at !== null));
});
