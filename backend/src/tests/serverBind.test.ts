import assert from "node:assert/strict";
import test from "node:test";

import { resolveBankingBindHost } from "../serverBind.js";

test("API listener keeps the container-compatible default unless explicitly narrowed", () => {
  assert.equal(resolveBankingBindHost({ BANKING_ENV: "development" }), "0.0.0.0");
  assert.equal(resolveBankingBindHost({ BANKING_ENV: "staging" }), "0.0.0.0");
});

test("local development can bind only to IPv4 loopback for the HTTPS learning proxy", () => {
  assert.equal(
    resolveBankingBindHost({ BANKING_ENV: "development", BANKING_BIND_HOST: "127.0.0.1" }),
    "127.0.0.1",
  );
  assert.equal(
    resolveBankingBindHost({ BANKING_ENV: "test", BANKING_BIND_HOST: "127.0.0.1" }),
    "127.0.0.1",
  );
});

test("preview and production-like runtimes reject loopback or arbitrary bind addresses", () => {
  for (const environment of ["preview", "staging", "production-like"]) {
    assert.throws(
      () => resolveBankingBindHost({ BANKING_ENV: environment, BANKING_BIND_HOST: "127.0.0.1" }),
      /BANKING_BIND_HOST may use 127\.0\.0\.1 only in development\/test/,
    );
  }
  assert.throws(
    () => resolveBankingBindHost({ BANKING_ENV: "development", BANKING_BIND_HOST: "192.168.1.25" }),
    /BANKING_BIND_HOST may use 127\.0\.0\.1 only in development\/test/,
  );
});
