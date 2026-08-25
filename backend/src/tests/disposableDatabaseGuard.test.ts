import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDisposableDatabaseAdminUrl,
  assertDisposableDatabaseResetAllowed,
} from "../database/disposableDatabaseGuard.js";

const validEnvironment = {
  NODE_ENV: "test",
  BANKING_ENV: "test",
  ALLOW_DATABASE_TEST_RESET: "1",
};
const validUrl = "postgresql://banking:secret@localhost:5432/banking_test_guard";

test("accepts a local disposable database with the required test markers", () => {
  const target = assertDisposableDatabaseResetAllowed(validUrl, validEnvironment);
  assert.equal(target.databaseName, "banking_test_guard");
  assert.equal(target.hostname, "localhost");
});

test("rejects preview database names", () => {
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(
      "postgresql://banking:secret@localhost:5432/banking_preview",
      validEnvironment,
    ),
    /banking_test_<suffix>|forbidden database/,
  );
});

test("rejects missing or incorrect environment markers", () => {
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, { ...validEnvironment, NODE_ENV: "development" }),
    /NODE_ENV=test/,
  );
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, { ...validEnvironment, BANKING_ENV: "preview" }),
    /BANKING_ENV=test/,
  );
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, { ...validEnvironment, ALLOW_DATABASE_TEST_RESET: "0" }),
    /ALLOW_DATABASE_TEST_RESET=1/,
  );
});

test("rejects unknown hosts and URLs that match a preview reference", () => {
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, {
      ...validEnvironment,
      DATABASE_TEST_ALLOWED_HOSTS: "db.example.invalid",
    }),
    /not in DATABASE_TEST_ALLOWED_HOSTS/,
  );
  assert.throws(
    () => assertDisposableDatabaseResetAllowed(validUrl, {
      ...validEnvironment,
      PREVIEW_DATABASE_URL: validUrl,
    }),
    /matches a development\/preview database URL/,
  );
});

test("admin connection is limited to the postgres maintenance database", () => {
  assert.doesNotThrow(() => assertDisposableDatabaseAdminUrl("postgresql://banking:secret@localhost:5432/postgres", validEnvironment));
  assert.throws(
    () => assertDisposableDatabaseAdminUrl("postgresql://banking:secret@localhost:5432/banking_preview", validEnvironment),
    /postgres or template1/,
  );
});

