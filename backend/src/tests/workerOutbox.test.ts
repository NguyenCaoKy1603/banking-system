import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { DatabasePool } from "../database/pool.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";
import {
  FakeEmailProvider,
  FakePushProvider,
} from "../notifications/providers/provider.js";
import { ProviderError } from "../outbox/errorClassifier.js";
import { PostgresOutboxRepository } from "../outbox/postgresOutboxRepository.js";
import { PostgresRelationalRepository } from "../postgresRelationalRepository.js";
import { WorkerRuntime, type WorkerConfig } from "../workers/workerRuntime.js";

const databaseUrl =
  process.env.WORKER_DATABASE_URL?.trim();

async function clearDatabase(database: DatabasePool): Promise<void> {
  await database.query("UPDATE transfer_quotes SET consumed_transfer_id = NULL WHERE consumed_transfer_id IS NOT NULL");
  for (const table of [
    "notification_deliveries",
    "dead_letter_events",
    "notification_endpoints",
    "notification_preferences",
    "worker_instances",
    "savings_maturity_operations",
    "savings_idempotency",
    "credit_idempotency",
    "refresh_session_records",
    "refresh_session_families",
    "auth_challenges",
    "pending_registrations",
    "rate_limit_buckets",
    "command_idempotency",
    "registration_completions",
    "reference_runtime_records",
    "outbox_events",
    "notifications",
    "audit_events",
    "account_transactions",
    "ledger_entries",
    "ledger_journals",
    "transfers",
    "transfer_quotes",
    "beneficiaries",
    "payment_accounts",
    "auth_sessions",
    "customer_devices",
    "customers",
  ]) {
    await database.query(`DELETE FROM ${table}`);
  }
}

before(async () => {
  if (!databaseUrl) return;
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  await clearDatabase(database);
  await database.close();
});

after(async () => {
  if (!databaseUrl) return;
  const database = new DatabasePool({ connectionString: databaseUrl, max: 4 });
  await clearDatabase(database);
  await database.close();
});

let testTail = Promise.resolve();
async function serialTest<T>(operation: () => Promise<T>): Promise<T> {
  const previous = testTail;
  let release!: () => void;
  testTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function config(workerId: string, maxAttempts = 3): WorkerConfig {
  return {
    workerId,
    workerVersion: "worker-test",
    pollIntervalMs: 5,
    batchSize: 50,
    concurrency: 10,
    leaseSeconds: 60,
    maxAttempts,
    heartbeatIntervalMs: 10_000,
    shutdownTimeoutMs: 1_000,
    databaseUrl: databaseUrl ?? "",
    persistenceMode: "relational-v2",
    allowLegacyWriter: false,
  };
}

async function seedEvent(database: DatabasePool, options: { unknownType?: boolean; withEndpoint?: boolean } = {}): Promise<{
  customerId: string;
  notificationId: string;
  eventId: string;
  endpointId: string | null;
  crypto: EndpointCrypto;
}> {
  const customerId = randomUUID();
  const notificationId = randomUUID();
  const eventId = randomUUID();
  const endpointId = options.withEndpoint ? randomUUID() : null;
  const aggregateId = randomUUID();
  const occurredAt = new Date().toISOString();
  const eventType = options.unknownType ? "unsupported.event.v99" : "transfer.succeeded.v1";
  const envelope = {
    eventId,
    eventType,
    eventVersion: options.unknownType ? 99 : 1,
    aggregate: { type: "transfer", id: aggregateId, version: 1 },
    occurredAt,
    traceId: "worker-test-trace",
    subjectCustomerIds: [customerId],
    notificationIds: [notificationId],
  };
  await database.query(
    `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     VALUES ($1, 'Worker Test', $2, $3, 'salt', 'digest', NOW())`,
    [customerId, `worker-${customerId}@example.com`, `09${customerId.replaceAll("-", "").slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO notifications
       (id, customer_id, notification_type, title, body, resource_id, created_at)
     VALUES ($1, $2, 'TRANSFER', 'Transfer succeeded', 'A transfer completed.', $3, NOW())`,
    [notificationId, customerId, aggregateId],
  );
  const crypto = new EndpointCrypto("worker-test-key");
  if (endpointId) {
    await database.query(
      `INSERT INTO notification_endpoints
       (id, customer_id, device_id, channel, provider, platform,
        address_ciphertext, address_fingerprint, status)
       VALUES ($1, $2, 'worker-device', 'PUSH', 'FAKE', 'ANDROID', $3, $4, 'ACTIVE')`,
      [endpointId, customerId, crypto.encrypt("ExponentPushToken[worker-test]"), "worker-test-fingerprint"],
    );
  }
  await database.query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, deduplication_key, payload, status, priority,
       occurred_at, next_attempt_at, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, 'transfer', ($4::jsonb->'aggregate'->>'id'), 1,
             $5, $4::jsonb, 'PENDING', 10, $6, NOW(), 0, $6, $6)`,
    [eventId, eventType, options.unknownType ? 99 : 1, JSON.stringify(envelope), `worker-test:${eventId}`, occurredAt],
  );
  return { customerId, notificationId, eventId, endpointId, crypto };
}

async function seedLoadBatch(database: DatabasePool, count: number): Promise<string[]> {
  const crypto = new EndpointCrypto("worker-test-key");
  const rows = Array.from({ length: count }, (_, index) => {
    const customerId = randomUUID();
    const notificationId = randomUUID();
    const endpointId = randomUUID();
    const eventId = randomUUID();
    const aggregateId = randomUUID();
    const occurredAt = new Date(Date.now() - index).toISOString();
    return {
      customerId,
      notificationId,
      endpointId,
      eventId,
      aggregateId,
      occurredAt,
      addressCiphertext: crypto.encrypt(`ExponentPushToken[load-${index}]`),
      addressFingerprint: `worker-load-${index}`,
      payload: {
        eventId,
        eventType: "transfer.succeeded.v1",
        eventVersion: 1,
        aggregate: { type: "transfer", id: aggregateId, version: 1 },
        occurredAt,
        traceId: "worker-load-test",
        subjectCustomerIds: [customerId],
        notificationIds: [notificationId],
      },
    };
  });
  await database.query(
    `INSERT INTO customers
       (id, full_name, email, phone_number, password_salt, password_digest, created_at)
     SELECT row.id, 'Worker Load Test', 'load-' || row.id || '@example.com',
            '09' || replace(row.id::text, '-', '')::text, 'salt', 'digest', NOW()
     FROM jsonb_to_recordset($1::jsonb) AS row(id uuid)`,
    [JSON.stringify(rows.map((row) => ({ id: row.customerId })))],
  );
  await database.query(
    `INSERT INTO notifications
       (id, customer_id, notification_type, title, body, resource_id, created_at)
     SELECT row.id, row.customer_id, 'TRANSFER', 'Load transfer',
            'A load-test transfer completed.', row.aggregate_id, NOW()
     FROM jsonb_to_recordset($1::jsonb)
       AS row(id uuid, customer_id uuid, aggregate_id uuid)`,
    [JSON.stringify(rows.map((row) => ({ id: row.notificationId, customer_id: row.customerId, aggregate_id: row.aggregateId })))],
  );
  await database.query(
    `INSERT INTO notification_endpoints
       (id, customer_id, device_id, channel, provider, platform,
        address_ciphertext, address_fingerprint, status)
     SELECT row.id, row.customer_id, 'worker-load-device-' || row.id,
            'PUSH', 'FAKE', 'ANDROID', row.address_ciphertext,
            row.address_fingerprint, 'ACTIVE'
     FROM jsonb_to_recordset($1::jsonb)
       AS row(id uuid, customer_id uuid, address_ciphertext text, address_fingerprint text)`,
    [JSON.stringify(rows.map((row) => ({
      id: row.endpointId,
      customer_id: row.customerId,
      address_ciphertext: row.addressCiphertext,
      address_fingerprint: row.addressFingerprint,
    })))],
  );
  await database.query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, aggregate_type, aggregate_id,
        aggregate_version, deduplication_key, payload, status, priority,
        occurred_at, next_attempt_at, attempts, created_at, updated_at)
     SELECT row.event_id, 'transfer.succeeded.v1', 1, 'transfer', row.aggregate_id,
            1, row.deduplication_key, row.payload, 'PENDING', 10,
            row.occurred_at::timestamptz, NOW(), 0, row.occurred_at::timestamptz,
            row.occurred_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb)
       AS row(event_id uuid, aggregate_id uuid, deduplication_key text,
              payload jsonb, occurred_at text)`,
    [JSON.stringify(rows.map((row) => ({
      event_id: row.eventId,
      aggregate_id: row.aggregateId,
      deduplication_key: `worker-load:${row.eventId}`,
      payload: row.payload,
      occurred_at: row.occurredAt,
    })))],
  );
  return rows.map((row) => row.eventId);
}

const databaseTestOptions = { skip: !databaseUrl, concurrency: false } as const;
const loadTestOptions = {
  skip: !databaseUrl,
  concurrency: false,
} as const;

test("two workers claim one event and create one idempotent delivery", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => { await database.close(); });
  const fixture = await seedEvent(database, { withEndpoint: true });
  const pushA = new FakePushProvider();
  const pushB = new FakePushProvider();
  const runtimeA = new WorkerRuntime(config("worker-a"), database, {
    push: pushA,
    email: new FakeEmailProvider(),
    endpointCrypto: fixture.crypto,
  });
  const databaseB = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => { await databaseB.close(); });
  const runtimeB = new WorkerRuntime(config("worker-b"), databaseB, {
    push: pushB,
    email: new FakeEmailProvider(),
    endpointCrypto: fixture.crypto,
  });
  await Promise.all([runtimeA.runOnce(), runtimeB.runOnce()]);
  const state = await database.query("SELECT status FROM outbox_events WHERE id = $1", [fixture.eventId]);
  const deliveries = await database.query("SELECT status FROM notification_deliveries WHERE outbox_event_id = $1", [fixture.eventId]);
  assert.equal(state.rows[0]?.status, "DISPATCHED");
  assert.equal(deliveries.rowCount, 1);
  assert.equal(deliveries.rows[0]?.status, "SENT");
  assert.equal(pushA.calls.length + pushB.calls.length, 1);
}));

test("expired lease is reclaimed and stale worker cannot dispatch after ownership changes", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => { await database.close(); });
  const fixture = await seedEvent(database);
  const repositoryA = new PostgresOutboxRepository(database);
  const claimed = await repositoryA.claimBatch("dead-worker", 1, 1);
  assert.equal(claimed.length, 1);
  await database.query("UPDATE outbox_events SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1", [fixture.eventId]);
  const databaseB = new DatabasePool({ connectionString: databaseUrl!, max: 4 });
  t.after(async () => { await databaseB.close(); });
  const runtimeB = new WorkerRuntime(config("worker-b"), databaseB, {
    push: new FakePushProvider(), email: new FakeEmailProvider(), endpointCrypto: fixture.crypto,
  });
  await runtimeB.runOnce();
  assert.equal(await repositoryA.markDispatched(fixture.eventId, "dead-worker"), false);
  const row = await database.query("SELECT status FROM outbox_events WHERE id = $1", [fixture.eventId]);
  assert.equal(row.rows[0]?.status, "DISPATCHED");
}));

test("unsupported event goes to dead-letter without touching financial tables", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 4 });
  t.after(async () => { await database.close(); });
  const fixture = await seedEvent(database, { unknownType: true });
  const before = await database.query("SELECT COUNT(*)::int AS count FROM account_transactions");
  const runtime = new WorkerRuntime(config("worker-dead", 3), database, {
    push: new FakePushProvider(), email: new FakeEmailProvider(), endpointCrypto: fixture.crypto,
  });
  await runtime.runOnce();
  const event = await database.query("SELECT status FROM outbox_events WHERE id = $1", [fixture.eventId]);
  const dead = await database.query("SELECT source_kind, source_id FROM dead_letter_events WHERE source_id = $1", [fixture.eventId]);
  const after = await database.query("SELECT COUNT(*)::int AS count FROM account_transactions");
  assert.equal(event.rows[0]?.status, "DEAD");
  assert.equal(dead.rows[0]?.source_kind, "OUTBOX");
  assert.equal(dead.rows[0]?.source_id, fixture.eventId);
  assert.equal(after.rows[0]?.count, before.rows[0]?.count);
  assert.equal(await runtime.repository.requeue(fixture.eventId, "operator fixed unsupported event", "worker-test-operator"), true);
  assert.equal(await runtime.repository.requeue(fixture.eventId, "second requeue is idempotent", "worker-test-operator"), false);
}));

test("provider failure dead-letters delivery after maximum attempts", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 4 });
  t.after(async () => { await database.close(); });
  const fixture = await seedEvent(database, { withEndpoint: true });
  const runtime = new WorkerRuntime(config("worker-provider-failure", 1), database, {
    push: new FakePushProvider(() => new ProviderError("provider timeout", { status: 500, code: "HTTP_500" })),
    email: new FakeEmailProvider(), endpointCrypto: fixture.crypto,
  });
  await runtime.runOnce();
  const delivery = await database.query("SELECT status FROM notification_deliveries WHERE outbox_event_id = $1", [fixture.eventId]);
  const dead = await database.query("SELECT source_kind FROM dead_letter_events WHERE source_id = (SELECT id FROM notification_deliveries WHERE outbox_event_id = $1)", [fixture.eventId]);
  assert.equal(delivery.rows[0]?.status, "DEAD");
  assert.equal(dead.rows[0]?.source_kind, "DELIVERY");
}));

test("invalid endpoint ciphertext is revoked and dead-letters without provider call", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 4 });
  t.after(async () => { await database.close(); });
  const fixture = await seedEvent(database, { withEndpoint: true });
  await database.query("UPDATE notification_endpoints SET address_ciphertext = 'not-valid-ciphertext' WHERE id = $1", [fixture.endpointId]);
  const push = new FakePushProvider();
  const runtime = new WorkerRuntime(config("worker-invalid-endpoint", 3), database, {
    push,
    email: new FakeEmailProvider(),
    endpointCrypto: fixture.crypto,
  });
  await runtime.runOnce();
  const delivery = await database.query("SELECT status FROM notification_deliveries WHERE outbox_event_id = $1", [fixture.eventId]);
  const endpoint = await database.query("SELECT status FROM notification_endpoints WHERE id = $1", [fixture.endpointId]);
  assert.equal(delivery.rows[0]?.status, "DEAD");
  assert.equal(endpoint.rows[0]?.status, "INVALID");
  assert.equal(push.calls.length, 0);
}));

test("legacy full-state API writer refuses to overwrite a live worker lease", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
  t.after(async () => { await database.close(); });
  const fixture = await seedEvent(database);
  const worker = new WorkerRuntime(config("worker-boundary"), database, {
    push: new FakePushProvider(),
    email: new FakeEmailProvider(),
    endpointCrypto: fixture.crypto,
  });
  await worker.initialize();
  const legacy = new PostgresRelationalRepository({ connectionString: databaseUrl!, maxConnections: 2 });
  t.after(async () => { await legacy.close(); });
  await assert.rejects(
    () => legacy.withState({}, async (state) => ({ result: null, nextState: state })),
    /heartbeat is active|relational-v2 HTTP cutover/,
  );
  const event = await database.query("SELECT status FROM outbox_events WHERE id = $1", [fixture.eventId]);
  assert.equal(event.rows[0]?.status, "PENDING");
}));

test("legacy empty events stay pending until explicit operator reconciliation", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 4 });
  t.after(async () => { await database.close(); });
  const fixture = await seedEvent(database);
  await database.query(
    "UPDATE outbox_events SET aggregate_type = 'legacy', payload = '{}'::jsonb WHERE id = $1",
    [fixture.eventId],
  );
  const runtime = new WorkerRuntime(config("worker-legacy"), database, {
    push: new FakePushProvider(),
    email: new FakeEmailProvider(),
    endpointCrypto: fixture.crypto,
  });
  await runtime.runOnce();
  const event = await database.query("SELECT status FROM outbox_events WHERE id = $1", [fixture.eventId]);
  assert.equal(event.rows[0]?.status, "PENDING");
  const reconciled = await runtime.repository.reconcileLegacy({
    eventId: fixture.eventId,
    classification: "MAPPABLE_BUT_STALE",
    reason: "worker test explicit reconciliation",
    actor: "worker-test-operator",
  });
  assert.equal(reconciled, "SKIPPED");
  const requeued = await runtime.repository.requeue(fixture.eventId, "legacy event must be materialized first", "worker-test-operator");
  assert.equal(requeued, false);
  assert.equal(await runtime.repository.requeue(fixture.eventId, "second attempt must be idempotent", "worker-test-operator"), false);
  const audit = await database.query("SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY occurred_at", [fixture.eventId]);
  assert.ok(audit.rows.some((row) => row.event_type === "OUTBOX_LEGACY_RECONCILED"));
}));

test("worker stops claiming and records STOPPED after graceful shutdown", databaseTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 4 });
  const runtime = new WorkerRuntime(config("worker-shutdown"), database, {
    push: new FakePushProvider(),
    email: new FakeEmailProvider(),
    endpointCrypto: new EndpointCrypto("worker-test-key"),
  });
  const started = runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await runtime.stop();
  await started;
  const check = new DatabasePool({ connectionString: databaseUrl!, max: 1 });
  t.after(async () => { await check.close(); });
  const row = await check.query("SELECT status FROM worker_instances WHERE worker_id = $1", ["worker-shutdown"]);
  assert.equal(row.rows[0]?.status, "STOPPED");
}));

test("two workers drain a 1000-event batch without duplicate deliveries", loadTestOptions, async (t) => serialTest(async () => {
  const database = new DatabasePool({ connectionString: databaseUrl!, max: 12 });
  const databaseB = new DatabasePool({ connectionString: databaseUrl!, max: 12 });
  t.after(async () => { await database.close(); await databaseB.close(); });
  const eventIds = await seedLoadBatch(database, 1_000);
  const pushA = new FakePushProvider();
  const pushB = new FakePushProvider();
  const runtimeA = new WorkerRuntime(config("worker-load-a"), database, {
    push: pushA,
    email: new FakeEmailProvider(),
    endpointCrypto: new EndpointCrypto("worker-test-key"),
  });
  const runtimeB = new WorkerRuntime(config("worker-load-b"), databaseB, {
    push: pushB,
    email: new FakeEmailProvider(),
    endpointCrypto: new EndpointCrypto("worker-test-key"),
  });
  for (let round = 0; round < 100; round += 1) {
    await Promise.all([runtimeA.runOnce(), runtimeB.runOnce()]);
    const pending = await database.query<{ count: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM outbox_events WHERE id = ANY($1::uuid[]) AND status IN ('PENDING', 'PROCESSING')) +
         (SELECT COUNT(*) FROM notification_deliveries WHERE outbox_event_id = ANY($1::uuid[]) AND status IN ('PENDING', 'PROCESSING'))
       )::text AS count`,
      [eventIds],
    );
    if (pending.rows[0]?.count === "0") break;
  }
  const remaining = await database.query<{ count: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM outbox_events WHERE id = ANY($1::uuid[]) AND status <> 'DISPATCHED') +
       (SELECT COUNT(*) FROM notification_deliveries WHERE outbox_event_id = ANY($1::uuid[]) AND status <> 'SENT')
     )::text AS count`,
    [eventIds],
  );
  const deliveries = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM notification_deliveries WHERE outbox_event_id = ANY($1::uuid[]) AND status = 'SENT'",
    [eventIds],
  );
  const duplicates = await database.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM (
       SELECT outbox_event_id, notification_id, channel, endpoint_id, COUNT(*)
       FROM notification_deliveries
       WHERE outbox_event_id = ANY($1::uuid[])
       GROUP BY outbox_event_id, notification_id, channel, endpoint_id
       HAVING COUNT(*) > 1
     ) duplicate_groups`,
    [eventIds],
  );
  const remainingStatuses = await database.query(
    `SELECT 'outbox' AS kind, status, COUNT(*)::int AS count
     FROM outbox_events WHERE status <> 'DISPATCHED' GROUP BY status
     UNION ALL
     SELECT 'delivery' AS kind, status, COUNT(*)::int AS count
     FROM notification_deliveries WHERE status <> 'SENT' GROUP BY status
     ORDER BY kind, status`,
  );
  assert.equal(remaining.rows[0]?.count, "0", JSON.stringify(remainingStatuses.rows));
  assert.equal(deliveries.rows[0]?.count, "1000");
  assert.equal(duplicates.rows[0]?.count, "0");
  assert.equal(pushA.calls.length + pushB.calls.length, 1_000);
}));
