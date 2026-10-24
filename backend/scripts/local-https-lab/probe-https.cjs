"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const caPath = process.env.BANKING_LOCAL_HTTPS_CA_FILE?.trim();
if (!caPath || !path.isAbsolute(caPath)) {
  throw new Error("BANKING_LOCAL_HTTPS_CA_FILE must point to the lab CA certificate.");
}

let ca;
try {
  ca = fs.readFileSync(caPath);
} catch {
  throw new Error("The configured local HTTPS CA certificate is unavailable.");
}

const port = Number(process.env.BANKING_LOCAL_HTTPS_PORT ?? 5443);
const request = https.get({
  hostname: "localhost",
  port,
  path: "/readyz",
  ca,
  minVersion: "TLSv1.2",
  timeout: 5_000,
}, (response) => {
  response.resume();
  const tlsVersion = response.socket.getProtocol() ?? "unknown";
  const passed = response.statusCode === 200;
  process.stdout.write(`${JSON.stringify({
    result: passed ? "PASS" : "FAIL",
    status: response.statusCode ?? null,
    tlsVersion,
    hostnameVerified: true,
    bodyPrinted: false,
  })}\n`);
  if (!passed) process.exitCode = 1;
});

request.once("timeout", () => request.destroy(new Error("timeout")));
request.once("error", () => {
  process.stderr.write("Local HTTPS probe failed: connection, CA trust, or hostname verification did not succeed.\n");
  process.exitCode = 1;
});
