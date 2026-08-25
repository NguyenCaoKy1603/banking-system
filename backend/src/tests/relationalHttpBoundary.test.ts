import test from "node:test";
import assert from "node:assert/strict";

import { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";

test("relational HTTP boundary is opt-in and route scoped", () => {
  const unitOfWork = {} as ConstructorParameters<typeof RelationalHttpBoundary>[0];
  const disabled = new RelationalHttpBoundary(unitOfWork, "");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.isRouteEnabled("GET", ["accounts"]), false);

  const enabled = new RelationalHttpBoundary(unitOfWork, "auth,accounts");
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.isRouteEnabled("POST", ["auth", "login"]), true);
  assert.equal(enabled.isRouteEnabled("POST", ["auth", "refresh"]), true);
  assert.equal(enabled.isRouteEnabled("GET", ["accounts"]), true);
  assert.equal(enabled.isRouteEnabled("GET", ["accounts", "account-1", "transactions"]), true);
  assert.equal(enabled.isRouteEnabled("POST", ["auth", "register"]), false);
  assert.equal(enabled.isRouteEnabled("GET", ["auth", "mfa", "methods"]), false);
  assert.equal(enabled.isRouteEnabled("POST", ["transfers"]), false);
  const registration = new RelationalHttpBoundary(unitOfWork, "registration");
  assert.equal(registration.isRouteEnabled("POST", ["auth", "register"]), true);
  assert.equal(registration.isRouteEnabled("POST", ["auth", "register", "verify"]), true);
});

test("relational HTTP boundary rejects unknown route groups", () => {
  const unitOfWork = {} as ConstructorParameters<typeof RelationalHttpBoundary>[0];
  const transfers = new RelationalHttpBoundary(unitOfWork, "auth,transfers");
  assert.equal(transfers.isRouteEnabled("POST", ["transfers", "quote"]), true);
  assert.equal(transfers.isRouteEnabled("POST", ["transfers"]), true);
  assert.equal(transfers.isRouteEnabled("GET", ["transfers", "transfer-1"]), true);
  assert.throws(
    () => new RelationalHttpBoundary(unitOfWork, "auth,unknown"),
    /unsupported route group/,
  );
  assert.throws(
    () => new RelationalHttpBoundary(unitOfWork, "accounts"),
    /groups require auth/,
  );
});
