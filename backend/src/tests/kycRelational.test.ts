import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalKycService, mapKycDecisionStatus } from "../database/kycService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
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

async function createCustomerFixture(
  db: DatabasePool,
  overrides?: { id?: string; fullName?: string; email?: string; phoneNumber?: string }
): Promise<{ id: string; fullName: string; email: string; phoneNumber: string }> {
  const id = overrides?.id ?? randomUUID();
  const fullName = overrides?.fullName ?? "Synthetic Test Customer";
  const email = overrides?.email ?? `kyc-test-${randomUUID()}@example.test`;
  const phoneNumber = overrides?.phoneNumber ?? generateVietnamesePhone();
  await db.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, $2, $3, $4, 'fixture_salt', 'fixture_digest', NOW())`,
    [id, fullName, email, phoneNumber],
  );
  return { id, fullName, email, phoneNumber };
}

test("relational kyc verification suite covering KYC-01 through KYC-16", { skip: !databaseUrl }, async (t) => {
  let activePool: DatabasePool | null = new DatabasePool({ connectionString: databaseUrl!, max: 12 });
  t.after(async () => {
    if (activePool) {
      await activePool.close();
      activePool = null;
    }
  });

  const database = activePool;
  const unitOfWork = new UnitOfWork(database);
  const kycService = new RelationalKycService(unitOfWork);

  // =========================================================================
  // KYC-01 & KYC-02: Initial Draft Creation & Invalid Payload Validation
  // =========================================================================
  const customer1 = await createCustomerFixture(database);

  // KYC-01: Valid initial saveDraft
  const validDraftInput = {
    fullName: "Nguyen Van A",
    identityNumber: "012345678901",
    address: "123 Le Loi, Quan 1, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/id-card-front.png",
    syntheticDataConfirmed: true,
  };
  const draft1 = await kycService.saveDraft(customer1.id, validDraftInput);
  assert.equal(draft1.userId, customer1.id, "KYC-01: userId matches customer id");
  assert.equal(draft1.status, "DRAFT", "KYC-01: status is DRAFT");
  assert.equal(draft1.submittedAt, null, "KYC-01: submittedAt is null for draft");
  assert.equal(draft1.version, 1, "KYC-01: initial version is 1");
  assert.equal(draft1.identityNumberLast4, "8901", "KYC-01: identityNumberLast4 matches last 4 digits");
  assert.equal(draft1.rejectionReason, null, "KYC-01: rejectionReason is null");

  // Privacy check on DTO (KYC-01 / PRIV-01)
  const dtoString = JSON.stringify(draft1);
  assert.equal(
    dtoString.includes("012345678901"),
    false,
    "KYC-01: public DTO must never leak full identityNumber"
  );
  assert.equal(
    "identityNumber" in (draft1 as unknown as Record<string, unknown>),
    false,
    "KYC-01: identityNumber property must not exist on CustomerKycApplication"
  );

  // Persisted state check in DB (KYC-01)
  const dbDraftRows = await database.query<{
    status: string;
    submitted_at: string | null;
    version: string;
    synthetic_payload: { identityNumber?: string; fullName?: string };
  }>(
    "SELECT status, submitted_at, version, synthetic_payload FROM kyc_applications WHERE customer_id = $1",
    [customer1.id]
  );
  assert.equal(dbDraftRows.rows.length, 1, "KYC-01: Exactly one application row in DB");
  assert.equal(dbDraftRows.rows[0]?.status, "DRAFT", "KYC-01: Persisted status is DRAFT");
  assert.equal(dbDraftRows.rows[0]?.submitted_at, null, "KYC-01: Persisted submitted_at is null");
  assert.equal(dbDraftRows.rows[0]?.version, "1", "KYC-01: Persisted version is 1");

  // In-memory comparison of sensitive identity
  const persistedIdentity = dbDraftRows.rows[0]?.synthetic_payload?.identityNumber;
  assert.equal(
    persistedIdentity === "012345678901",
    true,
    "KYC-01: Persisted synthetic_payload identityNumber matches submitted value"
  );

  // Side effects verification (KYC-01)
  const audit01 = await database.query<{ event_type: string; resource_id: string }>(
    "SELECT event_type, resource_id FROM audit_events WHERE actor_customer_id = $1",
    [customer1.id]
  );
  assert.equal(audit01.rows.length, 1, "KYC-01: Exactly one audit event persisted");
  assert.equal(audit01.rows[0]?.event_type, "KYC_DRAFT_SAVED", "KYC-01: Audit event is KYC_DRAFT_SAVED");
  assert.equal(audit01.rows[0]?.resource_id, draft1.id, "KYC-01: Audit resource_id matches application id");

  const outbox01 = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM outbox_events WHERE aggregate_id = $1",
    [draft1.id]
  );
  assert.equal(outbox01.rows[0]?.count, "0", "KYC-01: Zero outbox events generated for draft");

  const notif01 = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM notifications WHERE customer_id = $1",
    [customer1.id]
  );
  assert.equal(notif01.rows[0]?.count, "0", "KYC-01: Zero notifications generated for draft");

  // KYC-02: Negative validation on invalid payload
  const customer2 = await createCustomerFixture(database);

  await assert.rejects(
    kycService.saveDraft(customer2.id, {
      fullName: "Nguyen Van B",
      identityNumber: "012345678902",
      address: "456 Le Loi, Quan 1, TP Ho Chi Minh",
      documentUri: "https://unauthorized.domain/passport.jpg",
      syntheticDataConfirmed: true,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "KYC-02: Must reject with DomainError");
      assert.equal(err.status, 422, "KYC-02: Must return HTTP 422 for invalid URI");
      return true;
    }
  );

  await assert.rejects(
    kycService.saveDraft(customer2.id, {
      fullName: "Nguyen Van B",
      identityNumber: "012345678902",
      address: "456 Le Loi, Quan 1, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/id-card-front.png",
      syntheticDataConfirmed: false,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "KYC-02: Must reject with DomainError");
      assert.equal(err.status, 422, "KYC-02: Must return HTTP 422 for unconfirmed synthetic data");
      return true;
    }
  );

  const dbRowsCust2 = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM kyc_applications WHERE customer_id = $1",
    [customer2.id]
  );
  assert.equal(dbRowsCust2.rows[0]?.count, "0", "KYC-02: No application row created for failed validation");

  const auditCust2 = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM audit_events WHERE actor_customer_id = $1",
    [customer2.id]
  );
  assert.equal(auditCust2.rows[0]?.count, "0", "KYC-02: No audit event created for failed validation");

  // =========================================================================
  // KYC-03: Concurrent Draft Creation & Partial Unique Index Collision
  // =========================================================================
  const customer3 = await createCustomerFixture(database);
  const client1 = await database.connect();
  let client1CleanedUp = false;

  try {
    await client1.query("BEGIN;");
    await client1.query("SET LOCAL lock_timeout = '5s';");

    const app1Id = randomUUID();
    const payloadT1 = {
      fullName: "Nguyen Van C",
      identityNumber: "012345678903",
      address: "789 Tran Hung Dao, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/doc1.png",
      syntheticDataConfirmed: true,
    };
    await client1.query(
      `INSERT INTO kyc_applications
         (id, customer_id, status, applicant_label, request_fingerprint, synthetic_payload, version, created_at, updated_at)
       VALUES ($1, $2, 'DRAFT', 'Synthetic KYC applicant', 'fp_t1_fixture', $3::jsonb, 1, NOW(), NOW())`,
      [app1Id, customer3.id, JSON.stringify(payloadT1)]
    );

    const t2Promise = kycService.saveDraft(customer3.id, {
      fullName: "Nguyen Van C - Concurrent",
      identityNumber: "012345678904",
      address: "789 Tran Hung Dao, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/doc2.png",
      syntheticDataConfirmed: true,
    });

    let t2Waiting = false;
    for (let i = 0; i < 50; i++) {
      const lockCheck = await database.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pg_locks
         WHERE granted = false AND locktype IN ('transactionid', 'tuple')`
      );
      if (Number(lockCheck.rows[0]?.count) > 0) {
        t2Waiting = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 50));
    }
    assert.equal(t2Waiting, true, "KYC-03: T2 must be waiting on lock collision with T1");

    await client1.query("COMMIT;");
    client1CleanedUp = true;

    await assert.rejects(
      t2Promise,
      (err: unknown) => {
        assert.ok(err instanceof DomainError, "KYC-03: T2 must reject with DomainError");
        assert.equal(err.status, 409, "KYC-03: T2 must receive HTTP 409 Conflict");
        assert.equal(err.message, "KYC application is already open.", "KYC-03: Conflict message matches open index mapping");
        return true;
      }
    );

    const appsCustomer3 = await database.query<{ id: string; status: string }>(
      "SELECT id, status FROM kyc_applications WHERE customer_id = $1",
      [customer3.id]
    );
    assert.equal(appsCustomer3.rows.length, 1, "KYC-03: Exactly one application exists in DB");
    assert.equal(appsCustomer3.rows[0]?.id, app1Id, "KYC-03: Persisted application is T1's application");
    assert.equal(appsCustomer3.rows[0]?.status, "DRAFT", "KYC-03: Status is DRAFT");
  } finally {
    if (!client1CleanedUp) {
      try { await client1.query("ROLLBACK;"); } catch {}
    }
    client1.release();
  }

  // =========================================================================
  // KYC-04, KYC-05, KYC-06: Identity Retention, Update, and Masking Rejection
  // =========================================================================
  // KYC-04: Update draft without supplying identityNumber -> identity is preserved
  const updateWithoutIdentity = await kycService.saveDraft(customer1.id, {
    fullName: "Nguyen Van A - Updated Name",
    address: "999 Dien Bien Phu, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/id-card-updated.png",
    syntheticDataConfirmed: true,
  });
  assert.equal(updateWithoutIdentity.status, "DRAFT", "KYC-04: status remains DRAFT");
  assert.equal(updateWithoutIdentity.version, 2, "KYC-04: version incremented to 2");
  assert.equal(updateWithoutIdentity.fullName, "Nguyen Van A - Updated Name", "KYC-04: fullName updated");
  assert.equal(updateWithoutIdentity.identityNumberLast4, "8901", "KYC-04: identityNumberLast4 preserved");

  const dbDraftCust1 = await database.query<{ synthetic_payload: { identityNumber?: string; fullName?: string } }>(
    "SELECT synthetic_payload FROM kyc_applications WHERE id = $1",
    [draft1.id]
  );
  assert.equal(
    dbDraftCust1.rows[0]?.synthetic_payload?.identityNumber === "012345678901",
    true,
    "KYC-04: Server-side synthetic identity retained when omitted in request"
  );

  // KYC-05: Update draft with a new full identityNumber
  const updateWithNewIdentity = await kycService.saveDraft(customer1.id, {
    fullName: "Nguyen Van A - New Identity",
    identityNumber: "987654321099",
    address: "999 Dien Bien Phu, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/id-card-updated.png",
    syntheticDataConfirmed: true,
  });
  assert.equal(updateWithNewIdentity.version, 3, "KYC-05: version incremented to 3");
  assert.equal(updateWithNewIdentity.identityNumberLast4, "1099", "KYC-05: identityNumberLast4 updated to new last 4");

  const dbDraftCust1V3 = await database.query<{ synthetic_payload: { identityNumber?: string } }>(
    "SELECT synthetic_payload FROM kyc_applications WHERE id = $1",
    [draft1.id]
  );
  assert.equal(
    dbDraftCust1V3.rows[0]?.synthetic_payload?.identityNumber === "987654321099",
    true,
    "KYC-05: Server-side synthetic identity updated to new full identity"
  );

  // KYC-06: Attempt update with masked or short identity
  await assert.rejects(
    kycService.saveDraft(customer1.id, {
      fullName: "Nguyen Van A - Masked",
      identityNumber: "********1099",
      address: "999 Dien Bien Phu, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/id-card-updated.png",
      syntheticDataConfirmed: true,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "KYC-06: Must reject masked identity with DomainError");
      assert.equal(err.status, 422, "KYC-06: Status must be 422");
      return true;
    }
  );

  await assert.rejects(
    kycService.saveDraft(customer1.id, {
      fullName: "Nguyen Van A - Short",
      identityNumber: "1234",
      address: "999 Dien Bien Phu, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/id-card-updated.png",
      syntheticDataConfirmed: true,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "KYC-06: Must reject short identity with DomainError");
      assert.equal(err.status, 422, "KYC-06: Status must be 422");
      return true;
    }
  );

  const dbDraftCust1Unchanged = await database.query<{ version: string }>(
    "SELECT version FROM kyc_applications WHERE id = $1",
    [draft1.id]
  );
  assert.equal(dbDraftCust1Unchanged.rows[0]?.version, "3", "KYC-06: Version unchanged after rejected calls");

  // =========================================================================
  // KYC-07: Leading Zero Text Preservation (No numeric coercion)
  // =========================================================================
  const customer7 = await createCustomerFixture(database);
  const leadingZeroIdentity = "000123450007";

  const draft7 = await kycService.saveDraft(customer7.id, {
    fullName: "Le Van Seven",
    identityNumber: leadingZeroIdentity,
    address: "07 Nguyen Hue, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/card7.png",
    syntheticDataConfirmed: true,
  });
  assert.equal(draft7.status, "DRAFT", "KYC-07: status is DRAFT");
  assert.equal(draft7.identityNumberLast4, "0007", "KYC-07: last4 preserves leading zeros as text in draft");
  assert.equal(draft7.identityNumberLast4.length, 4, "KYC-07: last4 length is exactly 4");

  const submit7 = await kycService.submit(customer7.id, {
    fullName: "Le Van Seven",
    address: "07 Nguyen Hue, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/card7.png",
    syntheticDataConfirmed: true,
  });
  assert.equal(submit7.status, "SUBMITTED", "KYC-07: status is SUBMITTED");
  assert.equal(submit7.identityNumberLast4, "0007", "KYC-07: last4 preserves leading zeros as text in submit");

  const dbCust7 = await database.query<{ synthetic_payload: { identityNumber?: string } }>(
    "SELECT synthetic_payload FROM kyc_applications WHERE id = $1",
    [submit7.id]
  );
  assert.equal(
    typeof dbCust7.rows[0]?.synthetic_payload?.identityNumber,
    "string",
    "KYC-07: Persisted identityNumber is strictly of type string"
  );
  assert.equal(
    dbCust7.rows[0]?.synthetic_payload?.identityNumber === leadingZeroIdentity,
    true,
    "KYC-07: Persisted identityNumber retains leading zeros intact"
  );

  // =========================================================================
  // KYC-08, KYC-09, KYC-10: Submit, Idempotent Replay, and Fingerprint Conflict
  // =========================================================================
  // KYC-08: Initial Submit
  const submitInput = {
    fullName: "Nguyen Van A - Ready",
    address: "999 Dien Bien Phu, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/id-card-final.png",
    syntheticDataConfirmed: true,
  };
  const submittedApp = await kycService.submit(customer1.id, submitInput);
  assert.equal(submittedApp.id, draft1.id, "KYC-08: Application ID remains consistent across transitions");
  assert.equal(submittedApp.status, "SUBMITTED", "KYC-08: Status transitions to SUBMITTED");
  assert.ok(submittedApp.submittedAt, "KYC-08: submittedAt is populated with ISO timestamp");
  assert.equal(submittedApp.version, 4, "KYC-08: Version incremented to 4");

  const dbSubRows = await database.query<{ status: string; submitted_at: string | null; version: string }>(
    "SELECT status, submitted_at, version FROM kyc_applications WHERE id = $1",
    [submittedApp.id]
  );
  assert.equal(dbSubRows.rows[0]?.status, "SUBMITTED", "KYC-08: DB status is SUBMITTED");
  assert.ok(dbSubRows.rows[0]?.submitted_at, "KYC-08: DB submitted_at is not null");

  const auditCust1Submit = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM audit_events WHERE actor_customer_id = $1 AND event_type = 'KYC_SUBMITTED'",
    [customer1.id]
  );
  assert.equal(auditCust1Submit.rows[0]?.count, "1", "KYC-08: Exactly 1 KYC_SUBMITTED audit event");

  // Canonical outbox event_type is security.kyc_submitted.v1 (mapped from SECURITY_KYC_SUBMITTED)
  const outboxCust1 = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM outbox_events WHERE aggregate_id = $1 AND (event_type = 'security.kyc_submitted.v1' OR event_type = 'SECURITY_KYC_SUBMITTED')",
    [submittedApp.id]
  );
  assert.equal(outboxCust1.rows[0]?.count, "1", "KYC-08: Exactly 1 outbox event for kyc submission");

  const notifCust1 = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM notifications WHERE customer_id = $1 AND notification_type = 'SECURITY'",
    [customer1.id]
  );
  assert.equal(notifCust1.rows[0]?.count, "1", "KYC-08: Exactly 1 SECURITY notification");

  // KYC-09: Idempotent replay of submit with same request fingerprint
  const replayApp = await kycService.submit(customer1.id, submitInput);
  assert.equal(replayApp.id, submittedApp.id, "KYC-09: Idempotent replay returns same application id");
  assert.equal(replayApp.status, "SUBMITTED", "KYC-09: Status remains SUBMITTED");
  assert.equal(replayApp.version, submittedApp.version, "KYC-09: Version unchanged on replay");

  const auditAfterReplay = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM audit_events WHERE actor_customer_id = $1 AND event_type = 'KYC_SUBMITTED'",
    [customer1.id]
  );
  assert.equal(auditAfterReplay.rows[0]?.count, "1", "KYC-09: No duplicate audit events on replay");

  const outboxAfterReplay = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM outbox_events WHERE aggregate_id = $1 AND (event_type = 'security.kyc_submitted.v1' OR event_type = 'SECURITY_KYC_SUBMITTED')",
    [submittedApp.id]
  );
  assert.equal(outboxAfterReplay.rows[0]?.count, "1", "KYC-09: No duplicate outbox events on replay");

  const notifAfterReplay = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM notifications WHERE customer_id = $1 AND notification_type = 'SECURITY'",
    [customer1.id]
  );
  assert.equal(notifAfterReplay.rows[0]?.count, "1", "KYC-09: No duplicate notifications on replay");

  // KYC-10: Conflicting submit with different fingerprint while application is processing
  const differentInput = {
    ...submitInput,
    address: "999 Conflicting Address, TP Ho Chi Minh",
  };
  await assert.rejects(
    kycService.submit(customer1.id, differentInput),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "KYC-10: Must reject different payload with DomainError");
      assert.equal(err.status, 409, "KYC-10: Status must be 409 Conflict");
      assert.equal(err.message, "KYC hồ sơ đang được xử lý; không thể thay đổi dữ liệu.");
      return true;
    }
  );

  // =========================================================================
  // KYC-11: NEEDS_MORE_INFO Lifecycle & submitted_at Timestamp Preservation
  // =========================================================================
  await database.query(
    "UPDATE kyc_applications SET status = 'NEEDS_MORE_INFO', decision_reason_code = 'BLURRY_DOCUMENT', updated_at = NOW() WHERE id = $1",
    [submittedApp.id]
  );

  const initialSubmittedAt = submittedApp.submittedAt;
  assert.ok(initialSubmittedAt, "KYC-11: baseline submittedAt exists");

  assert.throws(
    () => mapKycDecisionStatus("MORE_INFO_REQUIRED"),
    (err: unknown) => err instanceof DomainError && err.status === 422,
    "KYC-11: mapKycDecisionStatus rejects legacy alias MORE_INFO_REQUIRED with 422"
  );
  assert.equal(
    mapKycDecisionStatus("NEEDS_MORE_INFO"),
    "NEEDS_MORE_INFO",
    "KYC-11: mapKycDecisionStatus accepts canonical NEEDS_MORE_INFO"
  );

  const savedInNeedsMoreInfo = await kycService.saveDraft(customer1.id, {
    fullName: "Nguyen Van A - Cleared",
    address: "999 Dien Bien Phu, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/clear-front.png",
    syntheticDataConfirmed: true,
  });
  assert.equal(savedInNeedsMoreInfo.status, "NEEDS_MORE_INFO", "KYC-11: status remains NEEDS_MORE_INFO on saveDraft");
  assert.equal(savedInNeedsMoreInfo.version, 5, "KYC-11: version incremented to 5");
  assert.equal(
    savedInNeedsMoreInfo.submittedAt,
    initialSubmittedAt,
    "KYC-11: submittedAt is preserved when saving draft in NEEDS_MORE_INFO status"
  );

  const dbCust1NeedsMoreInfo = await database.query<{ submitted_at: string | null }>(
    "SELECT submitted_at FROM kyc_applications WHERE id = $1",
    [submittedApp.id]
  );
  assert.ok(dbCust1NeedsMoreInfo.rows[0]?.submitted_at, "KYC-11: DB submitted_at remains populated");

  const resubmittedApp = await kycService.submit(customer1.id, {
    fullName: "Nguyen Van A - Cleared",
    address: "999 Dien Bien Phu, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/clear-front.png",
    syntheticDataConfirmed: true,
  });
  assert.equal(resubmittedApp.status, "SUBMITTED", "KYC-11: status transitions back to SUBMITTED");
  assert.equal(resubmittedApp.version, 6, "KYC-11: version incremented to 6");
  assert.ok(resubmittedApp.submittedAt, "KYC-11: new submittedAt timestamp set");

  // =========================================================================
  // KYC-12: APPROVED Immutability (D-10 Precedence)
  // =========================================================================
  const customer12 = await createCustomerFixture(database);
  const app12 = await kycService.submit(customer12.id, {
    fullName: "Approved Customer",
    identityNumber: "012345678912",
    address: "12 Vo Van Kiet, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/app12.png",
    syntheticDataConfirmed: true,
  });
  await database.query("UPDATE kyc_applications SET status = 'APPROVED', updated_at = NOW() WHERE id = $1", [app12.id]);

  await assert.rejects(
    kycService.saveDraft(customer12.id, {
      fullName: "Modified Customer",
      address: "12 Vo Van Kiet, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/app12.png",
      syntheticDataConfirmed: true,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "KYC-12: saveDraft on APPROVED must reject with DomainError");
      assert.equal(err.status, 409, "KYC-12: Must return HTTP 409");
      assert.equal(err.message, "KYC application has already been approved.");
      return true;
    }
  );

  await assert.rejects(
    kycService.submit(customer12.id, {
      fullName: "Modified Customer",
      address: "12 Vo Van Kiet, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/app12.png",
      syntheticDataConfirmed: true,
    }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError, "KYC-12: submit on APPROVED must reject with DomainError");
      assert.equal(err.status, 409, "KYC-12: Must return HTTP 409");
      assert.equal(err.message, "KYC application has already been approved.");
      return true;
    }
  );

  // =========================================================================
  // KYC-13: REJECTED Lifecycle & Immutability (D-11)
  // =========================================================================
  const customer13 = await createCustomerFixture(database);
  const app13 = await kycService.submit(customer13.id, {
    fullName: "Rejected Customer",
    identityNumber: "012345678913",
    address: "13 Vo Van Kiet, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/app13.png",
    syntheticDataConfirmed: true,
  });
  await database.query(
    "UPDATE kyc_applications SET status = 'REJECTED', decision_reason_code = 'SUSPICIOUS_IDENTITY', updated_at = NOW() WHERE id = $1",
    [app13.id]
  );

  const newApp13 = await kycService.saveDraft(customer13.id, {
    fullName: "Resubmitted Customer",
    address: "13 Vo Van Kiet, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/app13-new.png",
    syntheticDataConfirmed: true,
  });
  assert.notEqual(newApp13.id, app13.id, "KYC-13: New application has a distinct id");
  assert.equal(newApp13.status, "DRAFT", "KYC-13: New application status is DRAFT");
  assert.equal(newApp13.version, 1, "KYC-13: New application starts at version 1");
  assert.equal(newApp13.identityNumberLast4, "8913", "KYC-13: Inherited identityNumberLast4 from previous rejected record");

  const oldApp13Db = await database.query<{ status: string; decision_reason_code: string }>(
    "SELECT status, decision_reason_code FROM kyc_applications WHERE id = $1",
    [app13.id]
  );
  assert.equal(oldApp13Db.rows[0]?.status, "REJECTED", "KYC-13: Previous record remains REJECTED");
  assert.equal(oldApp13Db.rows[0]?.decision_reason_code, "SUSPICIOUS_IDENTITY", "KYC-13: Previous reason preserved");

  const openCountCust13 = await database.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM kyc_applications
     WHERE customer_id = $1 AND status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO')`,
    [customer13.id]
  );
  assert.equal(openCountCust13.rows[0]?.count, "1", "KYC-13: Exactly 1 open application exists");

  // =========================================================================
  // KYC-14: PostgreSQL APPROVED Interleaving
  // =========================================================================
  const customer14 = await createCustomerFixture(database);
  const openApp14 = await kycService.submit(customer14.id, {
    fullName: "Interleaving Customer",
    identityNumber: "012345678914",
    address: "14 Vo Van Kiet, TP Ho Chi Minh",
    documentUri: "synthetic://kyc/app14.png",
    syntheticDataConfirmed: true,
  });

  const adminClient = await database.connect();
  let adminClientCleanedUp = false;

  try {
    await adminClient.query("BEGIN;");
    await adminClient.query("SET LOCAL lock_timeout = '5s';");

    await adminClient.query("SELECT id FROM kyc_applications WHERE id = $1 FOR UPDATE;", [openApp14.id]);
    await adminClient.query(
      "UPDATE kyc_applications SET status = 'APPROVED', updated_at = NOW() WHERE id = $1;",
      [openApp14.id]
    );

    const customerPromise = kycService.submit(customer14.id, {
      fullName: "Interleaving Customer - Concurrently Submitted",
      address: "14 Vo Van Kiet, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/app14-resubmitted.png",
      syntheticDataConfirmed: true,
    });

    let customerWaiting = false;
    for (let i = 0; i < 50; i++) {
      const lockCheck = await database.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pg_locks
         WHERE granted = false AND locktype IN ('transactionid', 'tuple')`
      );
      if (Number(lockCheck.rows[0]?.count) > 0) {
        customerWaiting = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 50));
    }
    assert.equal(customerWaiting, true, "KYC-14: Customer transaction must be blocked waiting on Admin lock");

    await adminClient.query("COMMIT;");
    adminClientCleanedUp = true;

    await assert.rejects(
      customerPromise,
      (err: unknown) => {
        assert.ok(err instanceof DomainError, "KYC-14: Customer must reject with DomainError");
        assert.equal(err.status, 409, "KYC-14: Customer must receive HTTP 409 Conflict");
        assert.equal(err.message, "KYC application has already been approved.");
        return true;
      }
    );

    const dbApp14 = await database.query<{ status: string }>(
      "SELECT status FROM kyc_applications WHERE id = $1",
      [openApp14.id]
    );
    assert.equal(dbApp14.rows[0]?.status, "APPROVED", "KYC-14: Application remains in APPROVED status");

    const totalAppsCust14 = await database.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM kyc_applications WHERE customer_id = $1",
      [customer14.id]
    );
    assert.equal(totalAppsCust14.rows[0]?.count, "1", "KYC-14: No duplicate application inserted");
  } finally {
    if (!adminClientCleanedUp) {
      try { await adminClient.query("ROLLBACK;"); } catch {}
    }
    adminClient.release();
  }

  // =========================================================================
  // KYC-15: Database Constraint Fault Mapping
  // =========================================================================
  const nonExistentCustomerId = randomUUID();
  await assert.rejects(
    kycService.saveDraft(nonExistentCustomerId, {
      fullName: "Nonexistent Customer",
      identityNumber: "012345678915",
      address: "15 Vo Van Kiet, TP Ho Chi Minh",
      documentUri: "synthetic://kyc/app15.png",
      syntheticDataConfirmed: true,
    }),
    (err: unknown) => {
      assert.notEqual((err as Record<string, unknown>)?.status, 409, "KYC-15: FK violation must not be masked as 409");
      const pgErr = err as Record<string, unknown>;
      assert.equal(pgErr?.code, "23503", "KYC-15: PostgreSQL 23503 foreign key violation rethrown directly");
      return true;
    }
  );

  const auditCust15 = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM audit_events WHERE actor_customer_id = $1",
    [nonExistentCustomerId]
  );
  assert.equal(auditCust15.rows[0]?.count, "0", "KYC-15: Zero audit events committed after FK violation rollback");

  // =========================================================================
  // KYC-16: Restart Read & Committed Data Integrity
  // =========================================================================
  await activePool.close();
  activePool = null;

  const restartedPool = new DatabasePool({ connectionString: databaseUrl!, max: 4 });
  activePool = restartedPool;
  const restartedUow = new UnitOfWork(restartedPool);
  const restartedKycService = new RelationalKycService(restartedUow);

  const restartedAppCust1 = await restartedKycService.get(customer1.id);
  assert.ok(restartedAppCust1, "KYC-16: get() successfully retrieves committed application after restart");
  assert.equal(restartedAppCust1.id, submittedApp.id, "KYC-16: Application ID matches");
  assert.equal(restartedAppCust1.status, "SUBMITTED", "KYC-16: Application status matches");
  assert.equal(restartedAppCust1.version, 6, "KYC-16: Application version matches");
  assert.equal(restartedAppCust1.identityNumberLast4, "1099", "KYC-16: identityNumberLast4 matches");

  const restartedAppCust14 = await restartedKycService.get(customer14.id);
  assert.ok(restartedAppCust14, "KYC-16: get() retrieves approved application after restart");
  assert.equal(restartedAppCust14.status, "APPROVED", "KYC-16: Status remains APPROVED after restart");

  const restartAuditCheck = await restartedPool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM audit_events WHERE actor_customer_id = $1",
    [customer1.id]
  );
  assert.ok(Number(restartAuditCheck.rows[0]?.count) >= 2, "KYC-16: Audit records intact after restart");

  const restartOutboxCheck = await restartedPool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM outbox_events WHERE aggregate_id = $1",
    [submittedApp.id]
  );
  assert.ok(Number(restartOutboxCheck.rows[0]?.count) >= 1, "KYC-16: Outbox records intact after restart");

  const restartNotifCheck = await restartedPool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM notifications WHERE customer_id = $1",
    [customer1.id]
  );
  assert.ok(Number(restartNotifCheck.rows[0]?.count) >= 1, "KYC-16: Notification records intact after restart");

  await restartedPool.close();
  activePool = null;
});
