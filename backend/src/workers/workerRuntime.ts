import os from "node:os";

import { DatabasePool } from "../database/pool.js";
import { classifyProviderError } from "../outbox/errorClassifier.js";
import { resolveEventPolicy, validateEnvelope } from "../outbox/eventRegistry.js";
import { PostgresOutboxRepository } from "../outbox/postgresOutboxRepository.js";
import { fullJitterDelayMs, retryDefaultsFromEnv } from "../outbox/retryPolicy.js";
import type { DeliveryRow, EndpointRow, OutboxEventRow, WorkerStatus } from "../outbox/types.js";
import { WorkerMetrics } from "../observability/metrics.js";
import { EndpointCrypto } from "../notifications/endpointCrypto.js";
import {
  DisabledEmailProvider,
  DisabledPushProvider,
  FakeEmailProvider,
  FakePushProvider,
  type EmailProvider,
  type ProviderInput,
  type ProviderSet,
  type PushProvider,
} from "../notifications/providers/provider.js";
import { emailTemplate, pushPayload } from "../notifications/templateRegistry.js";
import { referenceFor } from "../secrets/runtimeSecrets.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalLifecycleScheduler, scheduledLifecycleConfigFromEnv, type ScheduledLifecycleConfig } from "./lifecycleScheduler.js";

export type WorkerConfig = {
  workerId: string;
  workerVersion: string;
  pollIntervalMs: number;
  batchSize: number;
  concurrency: number;
  leaseSeconds: number;
  maxAttempts: number;
  heartbeatIntervalMs: number;
  shutdownTimeoutMs: number;
  databaseUrl: string;
  persistenceMode: string;
  allowLegacyWriter: boolean;
  environment?: "development" | "test" | "preview" | "staging" | "production-like";
  scheduledLifecycle?: ScheduledLifecycleConfig;
};

export function assertWorkerCutoverConfirmed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.WORKER_CUTOVER_CONFIRMED !== "1") {
    throw new Error("Worker start is blocked until the HTTP relational-v2 cutover is explicitly confirmed.");
  }
}

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function workerConfigFromEnv(databaseUrlOverride?: string): WorkerConfig {
  const databaseUrl = databaseUrlOverride?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for worker.");
  const workerId = process.env.WORKER_ID?.trim() || `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    workerId,
    workerVersion: process.env.WORKER_VERSION?.trim() || process.env.BUILD_COMMIT_SHA?.trim() || "local",
    pollIntervalMs: positiveEnv("OUTBOX_POLL_INTERVAL_MS", 1_000),
    batchSize: positiveEnv("OUTBOX_BATCH_SIZE", 50),
    concurrency: positiveEnv("OUTBOX_CONCURRENCY", 10),
    leaseSeconds: positiveEnv("OUTBOX_LEASE_SECONDS", 60),
    maxAttempts: positiveEnv("OUTBOX_MAX_ATTEMPTS", 8),
    heartbeatIntervalMs: positiveEnv("WORKER_HEARTBEAT_INTERVAL_MS", 10_000),
    shutdownTimeoutMs: positiveEnv("WORKER_SHUTDOWN_TIMEOUT_MS", 25_000),
    databaseUrl,
    environment: (process.env.BANKING_ENV?.trim().toLowerCase() || "development") as WorkerConfig["environment"],
    persistenceMode: process.env.BANKING_PERSISTENCE_MODE?.trim() || "legacy-state",
    allowLegacyWriter: process.env.WORKER_ALLOW_LEGACY_WRITER === "1",
    scheduledLifecycle: scheduledLifecycleConfigFromEnv(),
  };
}

export async function createProviderSetFromSecretProvider(provider: SecretProvider, environment: "development" | "test" | "preview" | "staging" | "production-like", required: boolean): Promise<ProviderSet> {
  const pushMode = (process.env.PUSH_PROVIDER?.trim() || "disabled").toLowerCase();
  const configuredEmailMode = (process.env.OUTBOX_EMAIL_PROVIDER?.trim() || process.env.EMAIL_PROVIDER?.trim() || "disabled").toLowerCase();
  // EMAIL_PROVIDER is also used by the API's OTP adapter. HTTP and Gmail SMTP
  // modes are API-only registration delivery and must not be mistaken for the
  // separate notification outbox adapter (the registration event deliberately
  // contains no plaintext OTP for a worker to reconstruct).
  const emailMode = configuredEmailMode === "http" || configuredEmailMode === "smtp" ? "disabled" : configuredEmailMode;
  if (!new Set(["fake", "disabled"]).has(pushMode)) {
    throw new Error("PUSH_PROVIDER supports only fake or disabled until a real provider adapter is configured.");
  }
  if (!new Set(["fake", "disabled"]).has(emailMode)) {
    throw new Error("EMAIL_PROVIDER supports only fake or disabled until a real provider adapter is configured.");
  }
  const push: PushProvider = pushMode === "fake" ? new FakePushProvider() : new DisabledPushProvider();
  const email: EmailProvider = emailMode === "fake" ? new FakeEmailProvider() : new DisabledEmailProvider();
  const endpointCrypto = await EndpointCrypto.fromSecretProvider(
    provider,
    {
      current: referenceFor("notificationEndpointKey", environment),
      previous: referenceFor("notificationEndpointKeyPrevious", environment),
    },
    {
      currentKeyId: process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_ID?.trim(),
      previousKeyId: process.env.NOTIFICATION_ENDPOINT_ENCRYPTION_KEY_PREVIOUS_ID?.trim(),
      required,
    },
  );
  return {
    push,
    email,
    endpointCrypto,
  };
}

function providerSetFromEnv(): ProviderSet {
  const pushMode = (process.env.PUSH_PROVIDER?.trim() || "disabled").toLowerCase();
  const configuredEmailMode = (process.env.OUTBOX_EMAIL_PROVIDER?.trim() || process.env.EMAIL_PROVIDER?.trim() || "disabled").toLowerCase();
  const emailMode = configuredEmailMode === "http" || configuredEmailMode === "smtp" ? "disabled" : configuredEmailMode;
  if (!new Set(["fake", "disabled"]).has(pushMode)) throw new Error("PUSH_PROVIDER supports only fake or disabled until a real provider adapter is configured.");
  if (!new Set(["fake", "disabled"]).has(emailMode)) throw new Error("EMAIL_PROVIDER supports only fake or disabled until a real provider adapter is configured.");
  return {
    push: pushMode === "fake" ? new FakePushProvider() : new DisabledPushProvider(),
    email: emailMode === "fake" ? new FakeEmailProvider() : new DisabledEmailProvider(),
    endpointCrypto: new EndpointCrypto(),
  };
}

export type WorkerRunResult = {
  reclaimed: { outbox: number; deliveries: number };
  claimed: number;
  dispatched: number;
  deliveriesClaimed: number;
  deliveriesSent: number;
  failures: number;
};

export type ScheduledLifecycleRun = Awaited<ReturnType<RelationalLifecycleScheduler["runOnce"]>>;

export class WorkerRuntime {
  readonly metrics = new WorkerMetrics();
  readonly repository: PostgresOutboxRepository;
  private readonly retry = retryDefaultsFromEnv();
  private running = false;
  private initialized = false;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private activeRuns = 0;
  private lifecycleStatus: WorkerStatus = "STARTING";
  private lastLoopErrorAt: string | null = null;
  private readonly lifecycleScheduler?: RelationalLifecycleScheduler;

  constructor(
    readonly config: WorkerConfig,
    private readonly database = new DatabasePool({ connectionString: config.databaseUrl }),
    private readonly providers = providerSetFromEnv(),
  ) {
    if (config.persistenceMode !== "relational-v2" && !config.allowLegacyWriter) {
      throw new Error(
        "Worker refuses to start while BANKING_PERSISTENCE_MODE is not relational-v2; legacy API writer can overwrite worker state.",
      );
    }
    if (config.leaseSeconds * 1000 <= config.pollIntervalMs) {
      throw new Error("OUTBOX_LEASE_SECONDS must exceed OUTBOX_POLL_INTERVAL_MS.");
    }
    this.repository = new PostgresOutboxRepository(database);
    if (config.scheduledLifecycle?.enabled) {
      this.lifecycleScheduler = new RelationalLifecycleScheduler(new UnitOfWork(database), config.scheduledLifecycle, this.metrics);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.database.query("SELECT 1 FROM outbox_events LIMIT 1");
    await this.database.query("SELECT 1 FROM worker_instances LIMIT 1");
    const requiredColumns = [
      "event_version", "aggregate_type", "aggregate_version", "deduplication_key",
      "status", "priority", "locked_by", "lease_expires_at", "dead_lettered_at",
      "last_error_code", "trace_id", "created_at", "updated_at",
    ];
    const columns = await this.database.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'outbox_events'
         AND column_name = ANY($1::text[])`,
      [requiredColumns],
    );
    if (columns.rowCount !== requiredColumns.length) {
      throw new Error("Outbox worker schema is incomplete; apply migrations 012 and 013 before starting the worker.");
    }
    const migrations = await this.database.query<{ migration_key: string }>(
      `SELECT migration_key FROM reference_schema_migrations
       WHERE migration_key IN ('012_outbox_worker', '013_outbox_worker_operations')`,
    );
    if (migrations.rowCount !== 2) {
      throw new Error("Outbox worker migrations 012 and 013 are not both recorded; refusing readiness.");
    }
    await this.repository.heartbeat({
      workerId: this.config.workerId,
      workerVersion: this.config.workerVersion,
      hostname: os.hostname(),
      status: "STARTING",
    });
    this.initialized = true;
  }

  async runOnce(): Promise<WorkerRunResult> {
    this.activeRuns += 1;
    this.metrics.set("worker_active_tasks", this.activeRuns);
    try {
      const reclaimed = await this.repository.reclaimExpired(this.config.workerId);
      this.metrics.increment("outbox_expired_leases_total", reclaimed.outbox);
      this.metrics.increment("notification_delivery_expired_leases_total", reclaimed.deliveries);
      const claimedEvents = await this.repository.claimBatch(this.config.workerId, this.config.batchSize, this.config.leaseSeconds);
      this.metrics.increment("outbox_claimed_total", claimedEvents.length);
      const eventResults = await this.mapWithConcurrency(claimedEvents, this.config.concurrency, (event) => this.dispatchEvent(event));
      const claimedDeliveries = await this.repository.claimDeliveries(this.config.workerId, this.config.batchSize, this.config.leaseSeconds);
      this.metrics.increment("notification_delivery_claimed_total", claimedDeliveries.length);
      const deliveryResults = await this.mapWithConcurrency(claimedDeliveries, this.config.concurrency, (delivery) => this.deliver(delivery));
      const providerMetrics = await this.repository.metrics(this.config.workerId);
      for (const [name, value] of Object.entries(providerMetrics)) this.metrics.set(name, value);
      const poolMetrics = this.database.metrics();
      this.metrics.set("database_pool_waiting", poolMetrics.waiting);
      this.metrics.set("database_pool_total", poolMetrics.total);
      this.metrics.set("database_pool_idle", poolMetrics.idle);
      this.metrics.set("database_query_total", poolMetrics.queryTotal);
      this.metrics.set("database_query_errors_total", poolMetrics.queryErrors);
      this.metrics.set("database_slow_queries_total", poolMetrics.slowQueries);
      this.metrics.set("database_last_slow_query_duration_seconds", poolMetrics.lastSlowQueryDurationMs / 1000);
      return {
        reclaimed,
        claimed: claimedEvents.length,
        dispatched: eventResults.filter(Boolean).length,
        deliveriesClaimed: claimedDeliveries.length,
        deliveriesSent: deliveryResults.filter(Boolean).length,
        failures: eventResults.filter((value) => value === false).length + deliveryResults.filter((value) => value === false).length,
      };
    } finally {
      this.activeRuns -= 1;
      this.metrics.set("worker_active_tasks", this.activeRuns);
    }
  }

  /** Test/rehearsal hook for one durable scheduler tick; production uses start(). */
  async runScheduledLifecycleOnce(asOf?: string): Promise<ScheduledLifecycleRun> {
    if (!this.lifecycleScheduler) {
      return { savingsMaturities: 0, savingsSuspenseResolved: 0, savingsSuspenseRetried: 0, savingsSuspenseDeadLettered: 0, statementsClosed: 0, statementsOverdue: 0, paymentsSettled: 0 };
    }
    return this.lifecycleScheduler.runOnce(asOf);
  }

  async start(): Promise<void> {
    await this.initialize();
    this.running = true;
    await this.setStatus("READY");
    if (this.lifecycleScheduler) await this.lifecycleScheduler.start();
    this.heartbeatTimer = setInterval(() => {
      void this.setStatus("READY").catch(() => undefined);
    }, this.config.heartbeatIntervalMs);
    while (this.running) {
      try {
        const result = await this.runOnce();
        if (result.claimed === 0 && result.deliveriesClaimed === 0) {
          await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
        }
      } catch (error) {
        // A transient database outage must not turn the worker into an
        // unbounded crash loop.  Keep the process alive for health/metrics and
        // let the next iteration retry after the normal poll delay.
        this.metrics.increment("worker_loop_error_total");
        this.lastLoopErrorAt = new Date().toISOString();
        await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
      }
    }
  }

  async stop(): Promise<void> {
    await this.lifecycleScheduler?.stop();
    if (!this.running) {
      await this.setStatus("STOPPED").catch(() => undefined);
      await this.database.close();
      return;
    }
    this.running = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await this.setStatus("DRAINING").catch(() => undefined);
    const deadline = Date.now() + this.config.shutdownTimeoutMs;
    while (this.activeRuns > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
    }
    await this.setStatus("STOPPED").catch(() => undefined);
    await this.database.close();
  }

  async health(): Promise<Record<string, unknown>> {
    await this.database.healthCheck();
    const metrics = await this.repository.metrics(this.config.workerId);
    const poolMetrics = this.database.metrics();
    const heartbeatAge = Number(metrics.worker_heartbeat_age_seconds ?? 0);
    const lifecycleHealthy = this.initialized && this.lifecycleStatus === "READY";
    const scheduledLifecycle = this.lifecycleScheduler?.health();
    const status = lifecycleHealthy && heartbeatAge < 60 && (!scheduledLifecycle || scheduledLifecycle.status !== "degraded") ? "ok" : "degraded";
    return {
      status,
      lifecycle: this.lifecycleStatus,
      initialized: this.initialized,
      checkedAt: new Date().toISOString(),
      lastLoopErrorAt: this.lastLoopErrorAt,
      workerId: this.config.workerId,
      workerVersion: this.config.workerVersion,
      scheduledLifecycle,
      ...metrics,
      database_pool_waiting: poolMetrics.waiting,
      database_pool_total: poolMetrics.total,
      database_pool_idle: poolMetrics.idle,
      database_query_total: poolMetrics.queryTotal,
      database_query_errors_total: poolMetrics.queryErrors,
      database_slow_queries_total: poolMetrics.slowQueries,
      database_last_slow_query_duration_seconds: poolMetrics.lastSlowQueryDurationMs / 1000,
      ...this.metrics.snapshot(),
    };
  }

  private async dispatchEvent(event: OutboxEventRow): Promise<boolean> {
    const startedAt = performance.now();
    try {
      const policy = resolveEventPolicy(event.eventType, event.eventVersion);
      if (!policy) {
        await this.repository.failOutbox({ event, workerId: this.config.workerId, code: "EVENT_VERSION_UNSUPPORTED", summary: "Event type or version is not registered.", permanent: true });
        return false;
      }
      const envelope = validateEnvelope(event.payload);
      if (
        envelope.eventId !== event.id ||
        envelope.eventType !== `${policy.eventType}.v${policy.version}` ||
        envelope.aggregate.id !== event.aggregateId ||
        envelope.aggregate.version !== event.aggregateVersion
      ) {
        throw new Error("EVENT_METADATA_MISMATCH");
      }
      const freshness = policy.freshnessSeconds;
      if (freshness !== null && Date.parse(envelope.occurredAt) < Date.now() - freshness * 1000) {
        await this.repository.skipLegacy(event, this.config.workerId, "SKIPPED_STALE", "freshness_window_elapsed");
        return true;
      }
      const uniqueNotificationIds = new Set(envelope.notificationIds);
      if (uniqueNotificationIds.size !== envelope.notificationIds.length) {
        throw new Error("NOTIFICATION_IDS_DUPLICATED");
      }
      const notifications = envelope.notificationIds.length > 0
        ? await this.repository.findNotifications(envelope.notificationIds)
        : await this.repository.findNotificationsByAggregate(event.aggregateId);
      if (envelope.notificationIds.length > 0 && notifications.length !== envelope.notificationIds.length) {
        await this.repository.failOutbox({
          event,
          workerId: this.config.workerId,
          code: "NOTIFICATION_NOT_FOUND",
          summary: "One or more notifications referenced by the event are missing.",
          permanent: true,
        });
        return false;
      }
      if (policy.channels.length > 0 && notifications.length === 0) {
        await this.repository.failOutbox({ event, workerId: this.config.workerId, code: "NOTIFICATION_NOT_FOUND", summary: "No notification matched the event aggregate.", permanent: true });
        return false;
      }
      const customerIds = envelope.subjectCustomerIds.length > 0
        ? envelope.subjectCustomerIds
        : [...new Set(notifications.map((notification) => notification.customerId))];
      const endpoints: EndpointRow[] = [];
      for (const channel of policy.channels) {
        const channelEndpoints = await this.repository.listActiveEndpoints(customerIds, channel);
        for (const endpoint of channelEndpoints) {
          const notification = notifications.find((candidate) => candidate.customerId === endpoint.customerId);
          if (notification && await this.repository.preferenceEnabled(endpoint.customerId, policy.category, channel)) {
            endpoints.push(endpoint);
          }
        }
      }
      const result = await this.repository.createDeliveriesAndDispatch({
        event,
        workerId: this.config.workerId,
        notifications,
        endpoints,
        channels: policy.channels,
      });
      if (result.dispatched) this.metrics.increment("outbox_dispatched_total", 1, { event_type: policy.eventType });
      return result.dispatched;
    } catch (error) {
      const classified = classifyProviderError(error);
      const policy = resolveEventPolicy(event.eventType, event.eventVersion);
      const maximumAttempts = Math.min(this.config.maxAttempts, policy?.maximumAttempts ?? this.config.maxAttempts);
      const permanent = classified.errorClass === "PERMANENT" ||
        /^(EVENT_|UNSAFE_|NOTIFICATION_)/.test(error instanceof Error ? error.message : "") ||
        event.attempts >= maximumAttempts;
      await this.repository.failOutbox({
        event,
        workerId: this.config.workerId,
        code: classified.code,
        summary: classified.summary,
        permanent,
        nextAttemptAt: new Date(Date.now() + fullJitterDelayMs(event.attempts, this.retry)).toISOString(),
      });
      if (classified.errorClass === "CONFIGURATION") this.metrics.increment("provider_configuration_error_total", 1, { scope: "outbox" });
      this.metrics.increment("outbox_retry_total", 1, { event_type: event.eventType, error_class: classified.errorClass });
      return false;
    } finally {
      this.metrics.observe("outbox_handler_duration_seconds", (performance.now() - startedAt) / 1000, { event_type: event.eventType });
    }
  }

  private async deliver(delivery: DeliveryRow): Promise<boolean> {
    const context = await this.repository.getDeliveryContext(delivery.id);
    if (!context) {
      await this.repository.failDelivery({ delivery, workerId: this.config.workerId, code: "DELIVERY_CONTEXT_MISSING", summary: "Delivery context is missing.", permanent: true });
      return false;
    }
    if (context.endpoint.status !== "ACTIVE") {
      await this.repository.failDelivery({
        delivery,
        workerId: this.config.workerId,
        code: "ENDPOINT_INACTIVE",
        summary: "Notification endpoint is no longer active.",
        permanent: true,
      });
      return false;
    }
    const policy = resolveEventPolicy(context.event.eventType, context.event.eventVersion);
    if (!policy) {
      await this.repository.failDelivery({ delivery, workerId: this.config.workerId, code: "EVENT_VERSION_UNSUPPORTED", summary: "Delivery event policy is not registered.", permanent: true });
      return false;
    }
    let address: string;
    try {
      address = this.providers.endpointCrypto.decrypt(context.endpoint.addressCiphertext, {
        environment: this.config.environment ?? process.env.BANKING_ENV ?? "preview",
        endpointId: context.endpoint.id,
        customerId: context.endpoint.customerId,
        schemaVersion: "026",
      });
    } catch {
      await this.repository.invalidateEndpoint(delivery.endpointId);
      await this.repository.failDelivery({
        delivery,
        workerId: this.config.workerId,
        code: "ENDPOINT_CIPHERTEXT_INVALID",
        summary: "Notification endpoint ciphertext could not be decrypted.",
        permanent: true,
      });
      this.metrics.increment("notification_delivery_dead_total", 1, { channel: delivery.channel, error_class: "INVALID_ENDPOINT" });
      return false;
    }
    try {
      const base: ProviderInput = {
        delivery,
        address,
        title: context.notification.title,
        body: context.notification.body,
        payload: pushPayload(context.notification),
      };
      const result = delivery.channel === "PUSH"
        ? await this.providers.push.send(base)
        : await this.providers.email.send({
            ...base,
            recipient: address,
            ...emailTemplate(policy, context.notification),
          });
      const sent = await this.repository.markDeliverySent({ deliveryId: delivery.id, workerId: this.config.workerId, providerMessageId: result.providerMessageId });
      if (sent) this.metrics.increment("notification_delivery_sent_total", 1, { channel: delivery.channel });
      return sent;
    } catch (error) {
      const classified = classifyProviderError(error);
      if (classified.errorClass === "INVALID_ENDPOINT") await this.repository.invalidateEndpoint(delivery.endpointId);
      const maximumAttempts = Math.min(this.config.maxAttempts, policy.maximumAttempts);
      const terminal = classified.errorClass === "PERMANENT" || classified.errorClass === "INVALID_ENDPOINT" || delivery.attempts >= maximumAttempts;
      await this.repository.failDelivery({
        delivery,
        workerId: this.config.workerId,
        code: classified.code,
        summary: classified.summary,
        permanent: terminal,
        nextAttemptAt: terminal ? null : new Date(Date.now() + (classified.retryAfterMs ?? fullJitterDelayMs(delivery.attempts, this.retry))).toISOString(),
      });
      if (classified.errorClass === "CONFIGURATION") this.metrics.increment("provider_configuration_error_total", 1, { scope: "delivery" });
      this.metrics.increment(terminal ? "notification_delivery_dead_total" : "notification_delivery_retry_total", 1, { channel: delivery.channel, error_class: classified.errorClass });
      return false;
    }
  }

  private async setStatus(status: WorkerStatus): Promise<void> {
    this.lifecycleStatus = status;
    await this.repository.heartbeat({
      workerId: this.config.workerId,
      workerVersion: this.config.workerVersion,
      hostname: os.hostname(),
      status,
    });
  }

  private async mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    let cursor = 0;
    const run = async (): Promise<void> => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(items[index]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
    return results;
  }
}
