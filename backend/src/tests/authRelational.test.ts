import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalAuthService } from "../database/relationalAuthService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { hashOpaqueToken } from "../security.js";
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
