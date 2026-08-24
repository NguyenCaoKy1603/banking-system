const assert = require("node:assert/strict");

const baseUrl = (
  process.env.CONTAINER_BASE_URL ??
  `http://127.0.0.1:${process.env.PORT ?? "5000"}/api/v1`
).replace(/\/+$/, "");
const apiSuffix = "/api/v1";
const rootUrl = baseUrl.endsWith(apiSuffix)
  ? baseUrl.slice(0, -apiSuffix.length) || new URL(baseUrl).origin
  : new URL(baseUrl).origin;
const operatorKey = process.env.BANKING_SANDBOX_OPERATOR_KEY?.trim();
const expectExisting = process.env.SMOKE_EXPECT_EXISTING === "1";
const smokeEmail =
  process.env.SMOKE_EMAIL?.trim() ?? `container-smoke-${Date.now()}@example.invalid`;
const smokePassword = process.env.SMOKE_PASSWORD ?? "ContainerSmokePassword1";
const smokeDeviceId = process.env.SMOKE_DEVICE_ID?.trim() ?? "container-smoke-device";

if (!operatorKey) {
  throw new Error("BANKING_SANDBOX_OPERATOR_KEY is required for the sandbox smoke flow.");
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function expectOk(path, init = {}, expectedStatus = 200) {
  const { response, body } = await request(path, init);
  assert.equal(response.status, expectedStatus, `Unexpected HTTP status for ${path}`);
  return body;
}

async function readSandboxOtp(challengeId) {
  const body = await expectOk(`/sandbox/otp/${challengeId}`, {
    headers: { "X-Sandbox-Operator-Key": operatorKey },
  });
  assert.equal(typeof body?.otp, "string");
  return body.otp;
}

async function registerUser() {
  const begin = await expectOk(
    "/auth/register",
    {
      method: "POST",
      headers: { "X-Device-ID": smokeDeviceId },
      body: JSON.stringify({
        fullName: "Container Smoke User",
        email: smokeEmail,
        phoneNumber: `090${Date.now().toString().slice(-8)}`,
        password: smokePassword,
      }),
    },
    202,
  );
  const otp = await readSandboxOtp(begin.challengeId);
  await expectOk(
    "/auth/register/verify",
    {
      method: "POST",
      headers: { "X-Device-ID": smokeDeviceId },
      body: JSON.stringify({
        challengeId: begin.challengeId,
        method: "OTP",
        proof: otp,
      }),
    },
    201,
  );
}

async function loginUser() {
  const { response, body } = await request("/auth/login", {
    method: "POST",
    headers: { "X-Device-ID": smokeDeviceId },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
  });
  let login = body;
  if (response.status === 202) {
    const otp = await readSandboxOtp(body.challengeId);
    login = await expectOk(
      "/auth/verify",
      {
        method: "POST",
        headers: { "X-Device-ID": smokeDeviceId },
        body: JSON.stringify({
          challengeId: body.challengeId,
          method: "OTP",
          proof: otp,
        }),
      },
      200,
    );
  } else {
    assert.equal(response.status, 200, "Login must return 200 or an MFA challenge.");
  }
  assert.equal(typeof login?.accessToken, "string");
  assert.equal(typeof login?.refreshToken, "string");
  return login;
}

async function main() {
  const live = await fetch(`${rootUrl}/livez`);
  assert.equal(live.status, 200, "liveness endpoint is not healthy");

  const ready = await fetch(`${rootUrl}/healthz`);
  const readyBody = await ready.json().catch(() => null);
  assert.equal(ready.status, 200, "readiness endpoint is not healthy");
  assert.equal(readyBody?.status, "ok");

  const configuredOrigins = (process.env.BANKING_ALLOWED_ORIGINS ?? "").trim();
  if (configuredOrigins && configuredOrigins !== "*") {
    const invalidOrigin = await fetch(`${rootUrl}/healthz`, {
      headers: { Origin: "https://not-allowed.example.invalid" },
    });
    assert.equal(invalidOrigin.status, 403, "invalid CORS origin was not rejected");
  }

  if (!expectExisting) {
    await registerUser();
  }
  const login = await loginUser();
  const accounts = await expectOk("/accounts", {
    headers: {
      Authorization: `Bearer ${login.accessToken}`,
      "X-Device-ID": smokeDeviceId,
    },
  });
  assert.ok(Array.isArray(accounts?.accounts));
  assert.ok(accounts.accounts.length > 0, "smoke user has no payment account");

  console.log(
    JSON.stringify({
      status: "passed",
      readiness: readyBody.status,
      accountCount: accounts.accounts.length,
      persistenceCheck: expectExisting ? "restart-login" : "initial-login",
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
