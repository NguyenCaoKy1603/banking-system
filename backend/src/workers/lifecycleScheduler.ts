import { RelationalLifecycleService, type CreditLifecycleSummary } from "../database/lifecycleService.js";
import { RelationalTransferService } from "../database/transferService.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { WorkerMetrics } from "../observability/metrics.js";

export type ScheduledLifecycleConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  batchSize: number;
  stallThresholdMs: number;
};

export type ScheduledLifecycleRunResult = CreditLifecycleSummary & {
  savingsMaturities: number;
  savingsSuspenseResolved: number;
  savingsSuspenseRetried: number;
  savingsSuspenseDeadLettered: number;
  interbankReconciled?: number;
};

function positiveEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function scheduledLifecycleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ScheduledLifecycleConfig {
  const pollIntervalMs = positiveEnv(env, "SCHEDULED_LIFECYCLE_POLL_INTERVAL_MS", 30_000);
  return {
    enabled: env.SCHEDULED_LIFECYCLE_ENABLED === "1",
    pollIntervalMs,
    batchSize: positiveEnv(env, "SCHEDULED_LIFECYCLE_BATCH_SIZE", 50),
    stallThresholdMs: positiveEnv(env, "SCHEDULED_LIFECYCLE_STALL_THRESHOLD_MS", Math.max(pollIntervalMs * 3, 60_000)),
  };
}

export type ScheduledLifecycleHealth = {
  enabled: boolean;
  status: "ok" | "disabled" | "degraded";
  lastSuccessfulTick: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  running: boolean;
  pollIntervalMs: number;
  batchSize: number;
};

/**
 * Runs durable Savings/Credit lifecycle commands in a catch-up loop. The
 * commands own the transaction, row locks and idempotency keys; this class is
 * only scheduling, health and metrics. It is intentionally usable by two
 * independent worker processes during disposable rehearsal.
 */
export class RelationalLifecycleScheduler {
  private readonly lifecycle: RelationalLifecycleService;
  private readonly transfers: RelationalTransferService;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<ScheduledLifecycleRunResult> | undefined;
  private started = false;
  private lastSuccessfulTick: string | null = null;
  private lastErrorAt: string | null = null;
  private lastErrorCode: string | null = null;

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly config: ScheduledLifecycleConfig,
    private readonly metrics: WorkerMetrics,
  ) {
    this.lifecycle = new RelationalLifecycleService(unitOfWork);
    this.transfers = new RelationalTransferService(unitOfWork);
    if (config.pollIntervalMs <= 0 || config.batchSize <= 0 || config.stallThresholdMs <= 0) {
      throw new Error("Scheduled lifecycle configuration must use positive values.");
    }
  }

  async runOnce(asOf = new Date().toISOString()): Promise<ScheduledLifecycleRunResult> {
    if (!this.config.enabled) return { savingsMaturities: 0, savingsSuspenseResolved: 0, savingsSuspenseRetried: 0, savingsSuspenseDeadLettered: 0, statementsClosed: 0, statementsOverdue: 0, paymentsSettled: 0 };
    if (this.inFlight) return this.inFlight;
    const run = this.runTick(asOf);
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = undefined;
    }
  }

  async start(): Promise<void> {
    if (!this.config.enabled || this.started) return;
    this.started = true;
    // A first tick is deliberately attempted before the regular interval so
    // downtime is caught up immediately. A transient failure degrades health;
    // the next poll retries without crashing the worker process.
    try {
      await this.runOnce();
    } catch {
      // runTick records a redacted error code and metrics.
    }
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined);
    }, this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.started = false;
    if (this.inFlight) await this.inFlight.catch(() => undefined);
  }

  health(now = Date.now()): ScheduledLifecycleHealth {
    if (!this.config.enabled) {
      return {
        enabled: false,
        status: "disabled",
        lastSuccessfulTick: null,
        lastErrorAt: null,
        lastErrorCode: null,
        running: Boolean(this.inFlight),
        pollIntervalMs: this.config.pollIntervalMs,
        batchSize: this.config.batchSize,
      };
    }
    const age = this.lastSuccessfulTick ? now - Date.parse(this.lastSuccessfulTick) : Number.POSITIVE_INFINITY;
    const lastSuccessAt = this.lastSuccessfulTick ? Date.parse(this.lastSuccessfulTick) : Number.NaN;
    const lastErrorAfterSuccess = Boolean(this.lastErrorAt) &&
      (!this.lastSuccessfulTick || Date.parse(this.lastErrorAt!) > lastSuccessAt);
    const status = Number.isFinite(age) && age <= this.config.stallThresholdMs && !lastErrorAfterSuccess ? "ok" : "degraded";
    return {
      enabled: true,
      status,
      lastSuccessfulTick: this.lastSuccessfulTick,
      lastErrorAt: this.lastErrorAt,
      lastErrorCode: this.lastErrorCode,
      running: Boolean(this.inFlight),
      pollIntervalMs: this.config.pollIntervalMs,
      batchSize: this.config.batchSize,
    };
  }

  private async runTick(asOf: string): Promise<ScheduledLifecycleRunResult> {
    const startedAt = performance.now();
    this.metrics.set("scheduled_lifecycle_running", 1);
    const beforeRetries = this.unitOfWork.metrics().retried;
    try {
      const savingsMaturities = await this.lifecycle.runSavingsMaturities(asOf, this.config.batchSize);
      const savingsSuspense = await this.lifecycle.runSavingsSuspense(asOf, this.config.batchSize);
      const credit = await this.lifecycle.runCreditLifecycle(asOf, this.config.batchSize);
      const interbankReconciled = await this.transfers.reconcilePendingInterbankTransfers(asOf, this.config.batchSize);
      const result = {
        savingsMaturities,
        savingsSuspenseResolved: savingsSuspense.resolved,
        savingsSuspenseRetried: savingsSuspense.retried,
        savingsSuspenseDeadLettered: savingsSuspense.deadLettered,
        interbankReconciled,
        ...credit,
      };
      this.lastSuccessfulTick = new Date().toISOString();
      this.lastErrorAt = null;
      this.lastErrorCode = null;
      this.metrics.increment("scheduled_lifecycle_ticks_total");
      this.metrics.increment("scheduled_lifecycle_success_total");
      this.metrics.increment("scheduled_lifecycle_jobs_succeeded_total", savingsMaturities + savingsSuspense.resolved + interbankReconciled + credit.statementsClosed + credit.statementsOverdue + credit.paymentsSettled);
      this.metrics.increment("scheduled_lifecycle_suspense_resolved_total", savingsSuspense.resolved);
      this.metrics.increment("scheduled_lifecycle_suspense_retry_total", savingsSuspense.retried);
      this.metrics.increment("scheduled_lifecycle_suspense_dead_letter_total", savingsSuspense.deadLettered);
      this.metrics.increment("scheduled_lifecycle_retry_total", savingsSuspense.retried + Math.max(0, this.unitOfWork.metrics().retried - beforeRetries));
      return result;
    } catch (error) {
      this.lastErrorAt = new Date().toISOString();
      this.lastErrorCode = error instanceof Error ? error.name || "lifecycle-error" : "lifecycle-error";
      this.metrics.increment("scheduled_lifecycle_ticks_total");
      this.metrics.increment("scheduled_lifecycle_error_total");
      this.metrics.increment("scheduled_lifecycle_retry_total", Math.max(0, this.unitOfWork.metrics().retried - beforeRetries));
      throw error;
    } finally {
      this.metrics.observe("scheduled_lifecycle_duration_seconds", (performance.now() - startedAt) / 1000);
      this.metrics.set("scheduled_lifecycle_running", 0);
      this.metrics.set("scheduled_lifecycle_last_success_timestamp_seconds", this.lastSuccessfulTick ? Date.parse(this.lastSuccessfulTick) / 1000 : 0);
    }
  }
}
