import assert from "node:assert/strict";
import test from "node:test";

import { resolveDatabaseSslConfig } from "../database/pool.js";

test("local development can explicitly use plaintext PostgreSQL", () => {
  assert.equal(resolveDatabaseSslConfig({
    env: { BANKING_ENV: "development", DATABASE_SSL_MODE: "disable" },
  }), undefined);
});

test("verify-full requires a CA and hostname and rejects certificate bypass", () => {
  assert.deepEqual(resolveDatabaseSslConfig({
    env: {
      BANKING_ENV: "staging",
      DATABASE_SSL_MODE: "verify-full",
      DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\\nci-ca\\n-----END CERTIFICATE-----",
      DATABASE_SERVER_NAME: "postgres.staging.example.test",
    },
  }), {
    rejectUnauthorized: true,
    ca: "-----BEGIN CERTIFICATE-----\nci-ca\n-----END CERTIFICATE-----",
    servername: "postgres.staging.example.test",
  });
  assert.throws(
    () => resolveDatabaseSslConfig({
      env: { BANKING_ENV: "staging", DATABASE_SSL_MODE: "verify-full", DATABASE_SERVER_NAME: "db.example.test" },
    }),
    /requires a CA certificate/,
  );
  assert.throws(
    () => resolveDatabaseSslConfig({
      env: { BANKING_ENV: "staging", DATABASE_SSL_MODE: "verify-full", DATABASE_CA_CERT: "ci-ca" },
    }),
    /requires DATABASE_SERVER_NAME/,
  );
});

test("production-like mode never silently falls back to plaintext", () => {
  assert.throws(
    () => resolveDatabaseSslConfig({ env: { BANKING_ENV: "production-like", DATABASE_SSL_MODE: "disable" } }),
    /require DATABASE_SSL_MODE=verify-full/,
  );
  assert.throws(
    () => resolveDatabaseSslConfig({ env: { BANKING_ENV: "staging", DATABASE_SSL_MODE: "unknown" } }),
    /DATABASE_SSL_MODE must be/,
  );
});

test("production-like mode rejects an explicit insecure ssl override", () => {
  assert.throws(
    () => resolveDatabaseSslConfig({
      env: { BANKING_ENV: "production-like" },
      ssl: { rejectUnauthorized: false },
    }),
    /rejectUnauthorized=true/,
  );
});
