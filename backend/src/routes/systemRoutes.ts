import type { IncomingMessage, ServerResponse } from "node:http";
import type { BankingSystem } from "../bankingSystem.js";
import { DomainError } from "../errors.js";
import type { RuntimeMetadata } from "../runtimeMetadata.js";
import { collectDatabaseMetrics } from "../observability/metrics.js";
import type { HttpOptions } from "../http.js";
import { writeResponse, writeTextResponse, writeError } from "./httpUtils.js";

export function runtimeMetadataFor(options: HttpOptions): RuntimeMetadata & { storage: string } {
  if (options.runtimeMetadata) {
    return {
      ...options.runtimeMetadata,
      storage: options.storage?.trim() || process.env.BANKING_STORAGE?.trim() || "in-memory",
    };
  }
  return {
    service: "banking-reference-backend",
    releaseId: process.env.RELEASE_ID?.trim() || "local",
    imageDigest: process.env.IMAGE_DIGEST?.trim() || "unknown",
    environment:
      options.environment?.trim() || process.env.BANKING_ENV?.trim() || "development",
    moneyMode: process.env.BANKING_MONEY_MODE?.trim() || "virtual",
    schemaVersion: process.env.SCHEMA_VERSION?.trim() || "unknown",
    migrationSetDigest: process.env.MIGRATION_SET_DIGEST?.trim() || "unknown",
    apiContractDigest: process.env.API_CONTRACT_DIGEST?.trim() || "unknown",
    builtAt: process.env.BUILD_CREATED_AT?.trim() || null,
    startedAt: new Date().toISOString(),
    storage: options.storage?.trim() || process.env.BANKING_STORAGE?.trim() || "in-memory",
    commitSha: options.commitSha?.trim() || process.env.BUILD_COMMIT_SHA?.trim() || "local",
  };
}

export function isStartupReady(options: HttpOptions): boolean {
  return typeof options.startupReady === "function"
    ? options.startupReady()
    : options.startupReady !== false;
}

export function collectRuntimeMetrics(options: HttpOptions): void {
  if (!options.metrics) return;
  collectDatabaseMetrics(options.metrics, options.databaseMetrics?.());
}

export function recordBusinessHealth(
  options: HttpOptions,
  health: { status: string; reconciliation?: string; pendingOutboxEvents?: number },
): void {
  if (!options.metrics) return;
  options.metrics.increment("banking_health_checks_total", 1, { status: health.status });
  options.metrics.set("banking_reconciliation_mismatch", health.reconciliation === "mismatch" ? 1 : 0);
  options.metrics.set("banking_outbox_pending_events", Number(health.pendingOutboxEvents ?? 0));
}

/**
 * Handles system routes: /livez, /startupz, /versionz, /healthz, /readyz, /metrics.
 * Returns true if the route was handled, false otherwise.
 */
export async function handleSystemRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: HttpOptions,
  system: BankingSystem,
  traceId: string,
): Promise<boolean> {
  if (request.method !== "GET") {
    return false;
  }

  if (requestUrl.pathname === "/livez") {
    writeResponse(response, 200, traceId, {
      ...runtimeMetadataFor(options),
      status: "ok",
      checkedAt: new Date().toISOString(),
    });
    return true;
  }

  if (requestUrl.pathname === "/startupz") {
    const ready = isStartupReady(options);
    writeResponse(response, ready ? 200 : 503, traceId, {
      ...runtimeMetadataFor(options),
      status: ready ? "ok" : "starting",
      checkedAt: new Date().toISOString(),
    });
    return true;
  }

  if (requestUrl.pathname === "/versionz") {
    writeResponse(response, 200, traceId, runtimeMetadataFor(options));
    return true;
  }

  if (requestUrl.pathname === "/healthz" || requestUrl.pathname === "/readyz") {
    if (options.readinessCheck && !options.instrumented) {
      try {
        await options.readinessCheck();
      } catch {
        writeError(
          response,
          503,
          traceId,
          new DomainError(503, "PERSISTENCE_UNAVAILABLE", "Persistent sandbox is temporarily unavailable."),
        );
        return true;
      }
    }
    const health = system.getHealth();
    if (options.businessHealthCheck) {
      try {
        const databaseHealth = await options.businessHealthCheck();
        health.status = health.status === "ok" && databaseHealth.status === "ok" ? "ok" : "degraded";
        health.reconciliation = health.reconciliation === "ok" && databaseHealth.reconciliation === "ok" ? "ok" : "mismatch";
        health.outbox = databaseHealth.outbox;
        health.pendingOutboxEvents = databaseHealth.pendingOutboxEvents;
      } catch {
        health.status = "degraded";
        health.outbox = "degraded";
      }
    }
    if (options.emailProviderHealth) {
      try {
        const emailProvider = await options.emailProviderHealth();
        health.emailProvider = emailProvider;
        const isProductionLike = options.environment === "staging" || options.environment === "production-like";
        if (isProductionLike && emailProvider.status === "degraded") {
          health.status = "degraded";
        }
      } catch {
        const isProductionLike = options.environment === "staging" || options.environment === "production-like";
        if (isProductionLike) {
          health.status = "degraded";
        }
        health.emailProvider = {
          provider: "smtp",
          status: "degraded",
          configured: false,
          credentialConfigured: false,
          lastErrorCode: "email-provider-health-failed",
        };
      }
    }
    recordBusinessHealth(options, health);
    writeResponse(response, health.status === "ok" ? 200 : 503, traceId, {
      ...runtimeMetadataFor(options),
      ...health,
    });
    return true;
  }

  if (requestUrl.pathname === "/metrics" && (options.mfaService || options.metrics)) {
    collectRuntimeMetrics(options);
    const sections = [options.metrics?.prometheus(), options.mfaService?.metrics.prometheus()].filter(Boolean);
    writeTextResponse(response, 200, traceId, `${sections.join("\n")}`);
    return true;
  }

  return false;
}
