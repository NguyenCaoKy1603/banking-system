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
  const mfa = new RelationalHttpBoundary(unitOfWork, "auth,mfa");
  assert.equal(mfa.isRouteEnabled("POST", ["auth", "login"]), true);
  assert.equal(mfa.isRouteEnabled("GET", ["auth", "mfa", "methods"]), true);
  assert.equal(mfa.isRouteEnabled("POST", ["auth", "mfa", "totp", "enroll"]), true);
  assert.equal(mfa.isRouteEnabled("POST", ["auth", "otp", "challenges"]), true);
  assert.equal(mfa.isRouteEnabled("POST", ["auth", "mfa", "recover", "enroll"]), true);
  const savings = new RelationalHttpBoundary(unitOfWork, "auth,savings");
  assert.equal(savings.isRouteEnabled("GET", ["savings", "products"]), true);
  assert.equal(savings.isRouteEnabled("POST", ["savings", "quotes"]), true);
  assert.equal(savings.isRouteEnabled("POST", ["savings", "deposits"]), true);
  assert.equal(savings.isRouteEnabled("GET", ["savings", "deposits"]), true);
  assert.throws(
    () => new RelationalHttpBoundary(unitOfWork, "mfa"),
    /groups require auth/,
  );
});
