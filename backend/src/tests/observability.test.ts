import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";
import { PrometheusRegistry } from "../observability/metrics.js";

test("HTTP observability normalizes request IDs, propagates W3C context and exports bounded metrics", async (t) => {
  const metrics = new PrometheusRegistry();
  const logs: Array<Record<string, unknown>> = [];
  const server = createBankingServer(new BankingSystem(), {
    metrics,
    logger: { log: (_level, _event, fields = {}) => logs.push(fields) },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;
  const traceId = "0123456789abcdef0123456789abcdef";
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`, {
    headers: {
      "X-Request-ID": "invalid request id",
      traceparent: `00-${traceId}-0123456789abcdef-01`,
    },
  });
  assert.equal(response.status, 200);
  const requestId = response.headers.get("x-request-id") ?? "";
  assert.match(requestId, /^[A-Za-z0-9._-]{1,64}$/);
  assert.equal(response.headers.get("x-trace-id"), traceId);
  assert.match(response.headers.get("traceparent") ?? "", new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
  const metricsResponse = await fetch(`http://127.0.0.1:${address.port}/metrics`);
  const body = await metricsResponse.text();
  assert.match(body, /http_requests_total\{[^}]*route="\/healthz"/);
  assert.match(body, /http_request_duration_seconds_bucket/);
  assert.equal(logs.some((entry) => entry.requestId === requestId && entry.traceId === traceId), true);
});

