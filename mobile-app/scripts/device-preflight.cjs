const { spawnSync } = require("node:child_process");
const path = require("node:path");

const DEFAULT_PACKAGE = "com.example.digitalbanking.mobile";
const DEFAULT_HEALTH_URL = "http://127.0.0.1:5000/healthz";

function getOption(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function findAdb() {
  if (process.env.ADB?.trim()) {
    return process.env.ADB.trim();
  }

  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (sdkRoot) {
    const candidate = path.join(
      sdkRoot,
      "platform-tools",
      process.platform === "win32" ? "adb.exe" : "adb",
    );
    const result = spawnSync(candidate, ["version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const candidate = path.join(
      process.env.LOCALAPPDATA,
      "Android",
      "Sdk",
      "platform-tools",
      "adb.exe",
    );
    const result = spawnSync(candidate, ["version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  return "adb";
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout?.trim() || "",
    stderr: result.stderr?.trim() || "",
    error: result.error,
  };
}

function runAdb(adb, serial, args) {
  return run(adb, ["-s", serial, ...args]);
}

function parseDevices(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^(\S+)\s+(device|offline|unauthorized)\b(?:\s+(.*))?$/))
    .filter(Boolean)
    .map((match) => ({
      serial: match[1],
      state: match[2],
      descriptor: match[3] || "",
    }));
}

function getProperty(adb, serial, property) {
  const result = runAdb(adb, serial, ["shell", "getprop", property]);
  return result.status === 0 ? result.stdout : "";
}

function inspectDevice(adb, packageName, device) {
  const qemu = getProperty(adb, device.serial, "ro.kernel.qemu");
  const model = getProperty(adb, device.serial, "ro.product.model");
  const apiLevel = getProperty(adb, device.serial, "ro.build.version.sdk");
  const packagePath = runAdb(adb, device.serial, ["shell", "pm", "path", packageName]);

  return {
    serial: device.serial,
    state: device.state,
    kind: qemu === "1" ? "emulator" : qemu === "0" ? "physical" : "unknown",
    model: model || null,
    apiLevel: apiLevel || null,
    packageInstalled: packagePath.status === 0 && packagePath.stdout.includes("package:"),
  };
}

async function checkHealth(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      url,
      reachable: response.ok,
      status: response.status,
      applicationStatus: payload && typeof payload.status === "string" ? payload.status : null,
      reconciliation:
        payload && typeof payload.reconciliation === "string" ? payload.reconciliation : null,
      outbox: payload && typeof payload.outbox === "string" ? payload.outbox : null,
    };
  } catch (error) {
    return {
      url,
      reachable: false,
      status: null,
      applicationStatus: null,
      reconciliation: null,
      outbox: null,
      error: error?.name === "AbortError" ? "timeout" : "unreachable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function checkMaestro() {
  const result = run("maestro", ["--version"]);
  return {
    installed: result.status === 0,
    version: result.status === 0 ? result.stdout.split(/\r?\n/)[0] : null,
  };
}

async function main() {
  const packageName = getOption("package", DEFAULT_PACKAGE);
  const healthUrl = getOption("health", DEFAULT_HEALTH_URL);
  const requirePhysical = hasFlag("require-physical");
  const adb = findAdb();
  const adbResult = run(adb, ["devices", "-l"]);
  const devices = adbResult.status === 0
    ? parseDevices(adbResult.stdout).map((device) => inspectDevice(adb, packageName, device))
    : [];
  const health = await checkHealth(healthUrl);
  const maestro = checkMaestro();
  const activeDevices = devices.filter((device) => device.state === "device");
  const physicalDevices = activeDevices.filter((device) => device.kind === "physical");
  const packageReady = activeDevices.some((device) => device.packageInstalled);
  const checks = {
    adb: adbResult.status === 0,
    deviceConnected: activeDevices.length > 0,
    appInstalled: packageReady,
    backendHealth: health.reachable && health.applicationStatus === "ok",
    physicalDevice: physicalDevices.length > 0,
    maestro: maestro.installed,
  };

  const output = {
    generatedAt: new Date().toISOString(),
    packageName,
    adb,
    health,
    maestro,
    devices,
    checks,
    mode: requirePhysical ? "physical-device-required" : "local-device-ready",
  };

  console.log(JSON.stringify(output, null, 2));

  const requiredChecks = ["adb", "deviceConnected", "appInstalled", "backendHealth"];
  const requiredPassed = requiredChecks.every((check) => checks[check]);
  if (!requiredPassed || (requirePhysical && !checks.physicalDevice)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Device preflight failed.");
  process.exitCode = 1;
});
