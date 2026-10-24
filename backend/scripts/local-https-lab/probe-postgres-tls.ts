import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DatabasePool } from "../../src/database/pool.js";

const connectionString = process.env.DATABASE_URL?.trim();
const caFile = process.env.BANKING_LOCAL_HTTPS_CA_FILE?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required for the disposable PostgreSQL TLS lab.");
if (!caFile) throw new Error("BANKING_LOCAL_HTTPS_CA_FILE must point to the lab CA certificate.");

let target: URL;
try {
  target = new URL(connectionString);
} catch {
  throw new Error("DATABASE_URL is invalid for the disposable PostgreSQL TLS lab.");
}
const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  !["localhost", "127.0.0.1", "::1"].includes(target.hostname) ||
  target.port !== "55433" ||
  targetDatabase !== "banking_tls_lab"
) {
  throw new Error("Refusing to run the TLS probe outside localhost:55433/banking_tls_lab.");
}

const ca = await readFile(caFile, "utf8");
const pool = new DatabasePool({
  connectionString,
  sslMode: "verify-full",
  ca,
  serverName: process.env.DATABASE_SERVER_NAME?.trim() || "localhost",
  max: 1,
});

try {
  const result = await pool.query<{ ssl: boolean; version: string | null }>(
    "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
  );
  assert.equal(result.rows.length, 1, "expected exactly one PostgreSQL TLS status row");
  assert.equal(result.rows[0]?.ssl, true, "expected PostgreSQL to report TLS enabled");
  process.stdout.write(`${JSON.stringify({
    result: "PASS",
    tlsEnabled: result.rows[0]?.ssl,
    tlsVersion: result.rows[0]?.version,
    hostnameVerified: true,
    queryParametersPrinted: false,
  })}\n`);
} finally {
  await pool.close();
}
