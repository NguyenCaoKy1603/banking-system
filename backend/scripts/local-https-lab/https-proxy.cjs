"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

function positivePort(value, fallback, name) {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return parsed;
}

const certificatePath = process.env.BANKING_LOCAL_HTTPS_CERT_PATH?.trim();
const privateKeyPath = process.env.BANKING_LOCAL_HTTPS_KEY_PATH?.trim();
if (!certificatePath || !path.isAbsolute(certificatePath) || !privateKeyPath || !path.isAbsolute(privateKeyPath)) {
  throw new Error("BANKING_LOCAL_HTTPS_CERT_PATH and BANKING_LOCAL_HTTPS_KEY_PATH must be absolute local file paths.");
}

for (const filePath of [certificatePath, privateKeyPath]) {
  if (!fs.statSync(filePath).isFile()) throw new Error("Local HTTPS certificate and key paths must be regular files.");
}

const tlsOptions = {
  cert: fs.readFileSync(certificatePath),
  key: fs.readFileSync(privateKeyPath),
  minVersion: "TLSv1.2",
};

const listenPort = positivePort(process.env.BANKING_LOCAL_HTTPS_PORT, 5443, "BANKING_LOCAL_HTTPS_PORT");
const backendPort = positivePort(process.env.BANKING_LOCAL_BACKEND_PORT, 5000, "BANKING_LOCAL_BACKEND_PORT");

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    connection: "close",
  });
  response.end(JSON.stringify(body));
}

const server = https.createServer(tlsOptions, (request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url ?? "/", "https://localhost").pathname;
  } catch {
    json(response, 400, { error: "bad_request" });
    return;
  }

  const allowedPath = pathname === "/readyz" || pathname === "/livez" || pathname === "/api/v1" || pathname.startsWith("/api/v1/");
  if (!allowedPath) {
    json(response, 404, { error: "not_found" });
    return;
  }

  const headers = { ...request.headers, host: `127.0.0.1:${backendPort}`, connection: "close" };
  const upstreamRequest = http.request({
    hostname: "127.0.0.1",
    port: backendPort,
    method: request.method,
    path: request.url,
    headers,
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
    upstreamResponse.once("end", () => {
      const route = pathname === "/readyz" || pathname === "/livez" ? "health" : "api";
      process.stdout.write(`${JSON.stringify({ event: "local_https_request", route, status: upstreamResponse.statusCode ?? 502 })}\n`);
    });
  });

  upstreamRequest.once("error", () => {
    if (!response.headersSent) json(response, 502, { error: "local_backend_unavailable" });
    else response.destroy();
  });
  request.pipe(upstreamRequest);
});

server.on("tlsClientError", () => {
  process.stdout.write(`${JSON.stringify({ event: "local_https_client_rejected" })}\n`);
});

server.listen(listenPort, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({
    event: "local_https_proxy_started",
    bindHost: "127.0.0.1",
    port: listenPort,
    backendHost: "127.0.0.1",
    backendPort,
    tlsMinimum: "TLSv1.2",
  })}\n`);
});

function stop() {
  server.close(() => process.exit(0));
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
