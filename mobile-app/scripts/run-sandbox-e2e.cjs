const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mobileRoot = process.cwd();
const backendRoot = path.resolve(mobileRoot, "..", "backend");
const maestroRoot = path.resolve(mobileRoot, "e2e", "maestro");
const flowArgument = process.argv[2] ?? "critical-m0-m4-m8.yaml";
const flowPath = path.resolve(maestroRoot, flowArgument);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const deviceId = process.env.MAESTRO_DEVICE ?? "emulator-5554";
const apiBaseUrl = (
  process.env.E2E_BASE_URL ?? "http://127.0.0.1:5000/api/v1"
).replace(/\/+$/, "");
const totpSecret = process.env.E2E_TOTP_SECRET?.trim();
const { Secret, TOTP } = require(path.join(backendRoot, "node_modules", "otpauth"));
let lastTotpStep = -1;

async function currentTotpCode() {
  if (!totpSecret) fail("E2E_TOTP_SECRET is required; the runner never reads a backend code endpoint.");
  let now = Date.now();
  let step = Math.floor(now / 30000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30000) - now + 250));
    now = Date.now();
    step = Math.floor(now / 30000);
  }
  lastTotpStep = step;
  const totp = new TOTP({ issuer: "Banking Reference", label: "mobile-e2e", algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(totpSecret) });
  return totp.generate({ timestamp: now });
}

function fail(message) {
  throw new Error(message);
}

function ensureFlowPath() {
  const relativePath = path.relative(maestroRoot, flowPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    fail("The E2E flow must be inside mobile-app/e2e/maestro.");
  }
  if (!fs.existsSync(flowPath)) {
    fail(`E2E flow was not found: ${relativePath}`);
  }
}

function randomSuffix() {
  return crypto.randomBytes(6).toString("hex");
}

function runSeed(environment) {
  const result = spawnSync(npmCommand, ["run", "seed:e2e"], {
    cwd: backendRoot,
    env: environment,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const secretValues = [
      environment.E2E_EMAIL,
      environment.E2E_PASSWORD,
      environment.E2E_PHONE,
      environment.E2E_TOTP_SECRET,
      environment.E2E_RECIPIENT_EMAIL,
      environment.E2E_RECIPIENT_PASSWORD,
    ].filter(Boolean);
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .replaceAll(/\b\d{12}\b/g, "[account-redacted]")
      .replaceAll(/\b\d{6}\b/g, "[otp-redacted]");
    const redacted = secretValues.reduce(
      (value, secret) => value.replaceAll(secret, "[secret-redacted]"),
      diagnostic,
    );
    const lines = redacted
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith(">"));
    const hint = lines.slice(-2).join(" ").slice(0, 500);
    const processError = result.error?.message ? ` ${result.error.message}` : "";
    fail(`E2E seed failed (exit ${result.status ?? "unknown"}).${processError} ${hint}`.trim());
  }
}

async function requestJson(pathname, init = {}, accessToken) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Device-ID": "e2e-device-android",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    fail(`E2E API preparation failed with HTTP ${response.status}.`);
  }
  return body;
}

async function resolveAccountNumber(environment) {
  let session = await requestJson("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: environment.E2E_EMAIL,
      password: environment.E2E_PASSWORD,
    }),
  });

  if (!session?.accessToken && session?.challengeId) {
    session = await requestJson("/auth/verify", {
      method: "POST",
      body: JSON.stringify({
        challengeId: session.challengeId,
        method: "TOTP",
        proof: await currentTotpCode(),
      }),
    });
  }

  if (!session?.accessToken) {
    fail("E2E preparation login did not return an access token.");
  }

  const accounts = await requestJson("/accounts", {}, session.accessToken);
  const accountId = accounts?.accounts?.[0]?.id;
  if (!accountId) {
    fail("E2E preparation user has no payment account.");
  }

  const accountNumber = await requestJson(
    `/accounts/${encodeURIComponent(accountId)}/number`,
    {},
    session.accessToken,
  );
  if (!/^\d{12}$/.test(accountNumber?.accountNumber ?? "")) {
    fail("E2E preparation did not return a valid account number.");
  }
  return accountNumber.accountNumber;
}

async function runMaestro(environment, accountNumber, artifactDirectory) {
  const wrapper = path.join(mobileRoot, "scripts", "run-maestro.cjs");
  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      "test",
      "--no-reinstall-driver",
      "--device",
      deviceId,
      "--test-output-dir",
      artifactDirectory,
      "--env",
      `APP_ID=${environment.APP_ID}`,
      "--env",
      `TEST_EMAIL=${environment.E2E_EMAIL}`,
      "--env",
      `TEST_PASSWORD=${environment.E2E_PASSWORD}`,
      "--env",
      `MFA_TOTP=${await currentTotpCode()}`,
      "--env",
      `ACCOUNT_NUMBER=${accountNumber}`,
      "--env",
      `TRANSFER_TOTP=${await currentTotpCode()}`,
      flowPath,
    ],
    {
      cwd: mobileRoot,
      env: environment,
      stdio: "inherit",
    },
  );

  return result.status ?? 1;
}

async function main() {
  ensureFlowPath();
  if (!totpSecret) {
    fail("Set E2E_TOTP_SECRET to the test fixture secret; do not configure fixed OTP values.");
  }
  const suffix = randomSuffix();
  const environment = {
    ...process.env,
    E2E_BASE_URL: apiBaseUrl,
    E2E_EMAIL: `e2e-${suffix}@example.test`,
    E2E_PASSWORD: `Sandbox-${suffix}!Aa1`,
    E2E_PHONE: `090${String(Number.parseInt(suffix.slice(0, 7), 16) % 10_000_000).padStart(7, "0")}`,
    E2E_TOTP_SECRET: totpSecret,
    E2E_RECIPIENT_EMAIL: `recipient-${suffix}@example.test`,
    E2E_RECIPIENT_PASSWORD: `Recipient-${suffix}!Aa1`,
    APP_ID: process.env.APP_ID ?? "com.example.digitalbanking.mobile",
  };
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "banking-maestro-"));

  try {
    runSeed(environment);
    const accountNumber = await resolveAccountNumber(environment);
    const status = await runMaestro(environment, accountNumber, artifactDirectory);
    if (status !== 0) {
      fail(`Maestro E2E failed with exit code ${status}.`);
    }
    console.log(`Sandbox E2E passed: ${path.relative(maestroRoot, flowPath)}`);
  } finally {
    fs.rmSync(artifactDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Sandbox E2E failed.");
  process.exitCode = 1;
});
