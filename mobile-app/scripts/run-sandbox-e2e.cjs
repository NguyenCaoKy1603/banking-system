const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const mobileRoot = process.cwd();
const backendRoot = path.resolve(mobileRoot, "..", "backend");
const maestroRoot = path.resolve(mobileRoot, "e2e", "maestro");
const flowArgument = process.argv[2] ?? "critical-m0-m4-m8.yaml";
const flowPath = path.resolve(maestroRoot, flowArgument);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const deviceId = process.env.MAESTRO_DEVICE ?? "emulator-5554";
let apiBindingDeviceId = process.env.E2E_API_DEVICE_ID?.trim() ?? "e2e-device-android";
const apiBaseUrl = (
  process.env.E2E_BASE_URL ?? "http://127.0.0.1:5000/api/v1"
).replace(/\/+$/, "");
const totpSecret = process.env.E2E_TOTP_SECRET?.trim();
const { Secret, TOTP } = require(path.join(backendRoot, "node_modules", "otpauth"));
const TOTP_PERIOD_MS = 30000;
// Keep the generated proof inside the new step.  The host and local API
// container can differ by a few seconds, so a small edge margin prevents a
// freshly generated code from looking like a future code to the API.
const TOTP_EDGE_GUARD_MS = 6000;
let lastTotpStep = -1;

async function currentTotpCode() {
  if (!totpSecret) fail("E2E_TOTP_SECRET is required; the runner never reads a backend code endpoint.");
  let now = Date.now();
  let step = Math.floor(now / TOTP_PERIOD_MS);
  while (step <= lastTotpStep || now - step * TOTP_PERIOD_MS < TOTP_EDGE_GUARD_MS) {
    const targetStep = Math.max(step, lastTotpStep + 1);
    const targetAt = targetStep * TOTP_PERIOD_MS + TOTP_EDGE_GUARD_MS;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, targetAt - now)));
    now = Date.now();
    step = Math.floor(now / TOTP_PERIOD_MS);
  }
  lastTotpStep = step;
  const totp = new TOTP({ issuer: "Banking Reference", label: "mobile-e2e", algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(totpSecret) });
  return totp.generate({ timestamp: now });
}

function fail(message) {
  throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findAdb() {
  const configured = process.env.ADB_PATH?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  const sdkRoot = process.env.ANDROID_HOME?.trim() || process.env.ANDROID_SDK_ROOT?.trim();
  const candidates = sdkRoot
    ? [path.join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")]
    : [];
  if (process.platform === "win32" && process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"));
  }
  const candidate = candidates.find((value) => fs.existsSync(value));
  if (candidate) return candidate;
  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["adb"], { encoding: "utf8" });
  return lookup.stdout?.split(/\r?\n/).find((value) => value.trim())?.trim() || "adb";
}

const adbPath = findAdb();

function uiResourceState(_resourceId) {
  // Each phased prepare flow ends immediately after Maestro focuses the
  // step-up TextInput.  Avoid polling uiautomator on Windows while the app is
  // reloading; that command can block even though the native field is ready.
  return { focused: true, textLength: 0 };
}

function dynamicStepUpResourceId() {
  const flowName = path.basename(flowPath);
  return {
    "critical-transfer-retry.yaml": "transfer-step-up-code",
    "critical-savings.yaml": "savings-step-up-code",
    "critical-credit.yaml": "credit-step-up-code",
  }[flowName] ?? null;
}

async function injectTotpWhenVisible(resourceId, isChildFinished) {
  const watchTimeoutMs = Number(process.env.E2E_TOTP_WATCH_TIMEOUT_MS ?? 300_000);
  const deadline = Date.now() + (Number.isFinite(watchTimeoutMs) ? watchTimeoutMs : 300_000);
  let sawField = false;
  let sawFocusedField = false;
  console.log(`E2E dynamic TOTP watcher active for ${resourceId}.`);
  while (!isChildFinished() && Date.now() < deadline) {
    // Wait until Maestro has tapped the field.  A visible TextInput is not
    // necessarily focused yet; injecting before focus would send the code to
    // nowhere and leave the submit button disabled.
    const state = uiResourceState(resourceId);
    if (state && !sawField) {
      sawField = true;
      console.log(`E2E dynamic TOTP field visible for ${resourceId}.`);
    }
    if (state?.focused && !sawFocusedField) {
      sawFocusedField = true;
      console.log(`E2E dynamic TOTP field focused for ${resourceId}.`);
    }
    if (state?.focused) {
      // The challenge is created immediately before this screen.  Generate
      // the current code without the edge wait used by host-side setup; the
      // the short post-focus flow step prevents the submit action from racing us.
      const code = await currentTotpCode();
      if (isChildFinished()) return false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (isChildFinished()) return false;
        const injected = spawnSync(
          adbPath,
          ["-s", deviceId, "shell", "input", "text", code],
          { encoding: "utf8", stdio: "ignore", timeout: 5000 },
        );
        if (injected.status === 0) {
          // adb returning success is the reliable signal here.  A second
          // uiautomator dump can race React Native's secure TextInput and
          // incorrectly report an empty value even though the native input
          // already received the characters.
          await delay(250);
          // Maestro may advance while the native keyboard is still shown.
          // Hide it after the proof has been sent to the focused TextInput so
          // the submit control can receive the next tap.
          spawnSync(
            adbPath,
            ["-s", deviceId, "shell", "input", "keyevent", "4"],
            { encoding: "utf8", stdio: "ignore", timeout: 5000 },
          );
          console.log(`E2E dynamic TOTP injected for ${resourceId}.`);
          return true;
        }
        await delay(250);
      }
      console.error(`E2E dynamic TOTP could not populate ${resourceId}; code value was not printed.`);
      return false;
    }
    await delay(250);
  }
  if (!sawField && !isChildFinished()) {
    console.error(`E2E dynamic TOTP field did not appear within the watcher timeout for ${resourceId}.`);
  }
  return false;
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

  const output = result.stdout ?? "";
  const jsonStart = output.indexOf("{\n");
  const jsonEnd = output.indexOf("\nSecrets are not printed.", jsonStart);
  if (jsonStart < 0 || jsonEnd < 0) {
    fail("E2E seed completed without returning the fixture manifest.");
  }
  try {
    return JSON.parse(output.slice(jsonStart, jsonEnd));
  } catch {
    fail("E2E seed returned an invalid fixture manifest.");
  }
}

async function requestJson(pathname, init = {}, accessToken) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Device-ID": apiBindingDeviceId,
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
  if (!/^\d{6,34}$/.test(accountNumber?.accountNumber ?? "")) {
    fail("E2E preparation did not return a valid full account number.");
  }
  return accountNumber.accountNumber;
}

function phasedFlowPaths() {
  const basename = path.basename(flowPath);
  const phases = {
    "critical-transfer-retry.yaml": [
      "critical-transfer-retry-prepare.yaml",
      "critical-transfer-retry-submit.yaml",
    ],
    "critical-savings.yaml": [
      "critical-savings-prepare.yaml",
      "critical-savings-submit.yaml",
    ],
    "critical-credit.yaml": [
      "critical-credit-prepare.yaml",
      "critical-credit-submit.yaml",
    ],
  }[basename];
  return phases?.map((name) => path.join(maestroRoot, name)) ?? null;
}

function runMaestroProcess(environment, flowFile, flowEnvironment, artifactDirectory) {
  const wrapper = path.join(mobileRoot, "scripts", "run-maestro.cjs");
  const args = [wrapper, "test", "--device", deviceId, "--test-output-dir", artifactDirectory];
  for (const [key, value] of flowEnvironment) args.push("--env", `${key}=${value}`);
  args.push(flowFile);
  const child = spawn(process.execPath, args, {
    cwd: mobileRoot,
    env: environment,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  return new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function runMaestro(environment, fixture, accountNumber, artifactDirectory) {
  const wrapper = path.join(mobileRoot, "scripts", "run-maestro.cjs");
  const dynamicStepUp = dynamicStepUpResourceId();
  const flowEnvironment = new Map([
    ["APP_ID", environment.APP_ID],
    ["TEST_EMAIL", environment.E2E_EMAIL],
    ["TEST_PASSWORD", environment.E2E_PASSWORD],
    ["ACCOUNT_NUMBER", accountNumber],
    ["BENEFICIARY_ID", fixture.BENEFICIARY_ID],
    ["TRANSFER_AMOUNT_MINOR", fixture.TRANSFER_AMOUNT_MINOR],
    ["SAVINGS_AMOUNT_MINOR", environment.E2E_SAVINGS_AMOUNT_MINOR ?? "1000000"],
  ]);
  // The transfer/savings/credit screens create their challenge only after the
  // long UI path reaches the step-up screen. Injecting the proof when that
  // field is visible avoids passing an expired TOTP generated before Maestro
  // starts. Other flows keep the existing static environment variables.
  if (!dynamicStepUp) {
    flowEnvironment.set("MFA_TOTP", await currentTotpCode());
    flowEnvironment.set("TRANSFER_TOTP", await currentTotpCode());
  }

  const phases = phasedFlowPaths();
  if (dynamicStepUp && phases) {
    const prepareStatus = await runMaestroProcess(
      environment,
      phases[0],
      flowEnvironment,
      artifactDirectory,
    );
    if (prepareStatus !== 0) return prepareStatus;

    const injected = await injectTotpWhenVisible(dynamicStepUp, () => false);
    if (!injected) {
      fail(`E2E preparation did not inject the dynamic TOTP for ${dynamicStepUp}.`);
    }
    return runMaestroProcess(environment, phases[1], flowEnvironment, artifactDirectory);
  }

  const args = [wrapper, "test", "--device", deviceId, "--test-output-dir", artifactDirectory];
  for (const [key, value] of flowEnvironment) args.push("--env", `${key}=${value}`);
  args.push(flowPath);
  const child = spawn(process.execPath, args, {
    cwd: mobileRoot,
    env: environment,
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  let childFinished = false;
  let appReady = false;
  let appReadyResolve;
  const appReadyPromise = new Promise((resolve) => {
    appReadyResolve = resolve;
  });
  let outputBuffer = "";
  child.stdout?.on("data", (chunk) => {
    const output = chunk.toString();
    process.stdout.write(output);
    outputBuffer = `${outputBuffer}${output}`.slice(-2_000);
    if (!appReady && outputBuffer.includes("Assert that id: quick-transfer is visible... COMPLETED")) {
      appReady = true;
      appReadyResolve(true);
    }
  });
  const childResult = new Promise((resolve) => {
    child.once("error", () => {
      childFinished = true;
      if (!appReady) appReadyResolve(false);
      resolve(1);
    });
    child.once("close", (code) => {
      childFinished = true;
      if (!appReady) appReadyResolve(false);
      resolve(code ?? 1);
    });
  });
  const injection = dynamicStepUp
    ? appReadyPromise.then((ready) =>
        ready ? injectTotpWhenVisible(dynamicStepUp, () => childFinished) : false,
      )
    : Promise.resolve(true);
  const [status, injected] = await Promise.all([childResult, injection]);
  if (dynamicStepUp && !injected && status === 0) {
    fail(`E2E flow completed without injecting the dynamic TOTP for ${dynamicStepUp}.`);
  }
  return status;
}

async function main() {
  ensureFlowPath();
  if (!totpSecret) {
    fail("Set E2E_TOTP_SECRET to the test fixture secret; do not configure fixed OTP values.");
  }
  const suffix = randomSuffix();
  const environment = {
    ...process.env,
    // The local Compose API uses the preview secret context.  Explicitly set
    // it for the host-side seed so backend/.env cannot silently switch the
    // fixture encryption context to development.
    BANKING_ENV: process.env.BANKING_ENV?.trim() || "preview",
    E2E_BASE_URL: apiBaseUrl,
    E2E_DEVICE_ID: `e2e-device-${suffix}`,
    E2E_RATE_LIMIT_KEY: `e2e-rate-${suffix}`,
    E2E_EMAIL: `e2e-${suffix}@example.test`,
    E2E_PASSWORD: `Sandbox${suffix}Aa1`,
    E2E_PHONE: `090${String(Number.parseInt(suffix.slice(0, 7), 16) % 10_000_000).padStart(7, "0")}`,
    E2E_TOTP_SECRET: totpSecret,
    E2E_CREDIT_APPROVE_FIXTURE: "1",
    E2E_RECIPIENT_EMAIL: `recipient-${suffix}@example.test`,
    E2E_RECIPIENT_PASSWORD: `Recipient${suffix}Aa1`,
    E2E_RECIPIENT_PHONE: `091${String(Number.parseInt(suffix.slice(2, 9), 16) % 10_000_000).padStart(7, "0")}`,
    APP_ID: process.env.APP_ID ?? "com.example.digitalbanking.mobile",
  };
  apiBindingDeviceId = environment.E2E_DEVICE_ID;
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "banking-maestro-"));

  try {
    const fixture = runSeed(environment);
    const accountNumber = await resolveAccountNumber(environment);
    const status = await runMaestro(environment, fixture, accountNumber, artifactDirectory);
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
