import { createServer, type Server } from "node:http";

import type { WorkerRuntime } from "./workerRuntime.js";

export class WorkerHealthServer {
  private server: Server | undefined;

  constructor(private readonly runtime: WorkerRuntime, private readonly port: number) {}

  async start(): Promise<void> {
    if (this.port <= 0) return;
    this.server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/livez") {
        response.statusCode = 200;
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (pathname === "/metrics") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; version=0.0.4");
        response.end(this.runtime.metrics.prometheus());
        return;
      }
      if (pathname === "/readyz") {
        void this.runtime.health().then(
          (health) => {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(health));
          },
          () => {
            response.statusCode = 503;
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
