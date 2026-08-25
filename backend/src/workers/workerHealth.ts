import { createServer, type Server } from "node:http";

import type { WorkerRuntime } from "./workerRuntime.js";
import { createRequestContext, requestContextHeaders } from "../observability/requestContext.js";

export class WorkerHealthServer {
  private server: Server | undefined;

  constructor(private readonly runtime: WorkerRuntime, private readonly port: number) {}

  async start(): Promise<void> {
    if (this.port <= 0) return;
    this.server = createServer((request, response) => {
      const context = createRequestContext(request, "worker");
      for (const [name, value] of Object.entries(requestContextHeaders(context))) response.setHeader(name, value);
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/livez") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ status: "ok", service: "banking-outbox-worker", checkedAt: new Date().toISOString() }));
        return;
      }
      if (pathname === "/startupz") {
        void this.runtime.health().then((health) => {
          const ready = health.initialized === true;
          response.statusCode = ready ? 200 : 503;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ ...health, status: ready ? "ok" : "starting" }));
        }, () => { response.statusCode = 503; response.end(JSON.stringify({ status: "starting" })); });
        return;
      }
      if (pathname === "/versionz") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ service: "banking-outbox-worker", workerVersion: this.runtime.config.workerVersion, workerId: this.runtime.config.workerId, imageDigest: process.env.IMAGE_DIGEST?.trim() || "unknown", commitSha: process.env.BUILD_COMMIT_SHA?.trim() || "local", environment: process.env.BANKING_ENV?.trim() || "development" }));
        return;
      }
      if (pathname === "/metrics") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; version=0.0.4");
        response.end(this.runtime.metrics.prometheus());
        return;
      }
      if (pathname === "/readyz" || pathname === "/healthz") {
        void this.runtime.health().then(
          (health) => {
            response.statusCode = health.status === "ok" ? 200 : 503;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(health));
          },
          () => {
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ status: "degraded" }));
          },
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
