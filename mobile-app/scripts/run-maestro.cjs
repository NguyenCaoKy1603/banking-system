const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function javaHomeFromPath(javaPath) {
  const normalized = javaPath.trim();
  if (!normalized) return null;
  const binDirectory = path.dirname(normalized);
  const homeDirectory = path.dirname(binDirectory);
  return fs.existsSync(path.join(homeDirectory, "bin", process.platform === "win32" ? "java.exe" : "java"))
    ? homeDirectory
    : null;
}

function findJavaHome() {
  const configured = process.env.JAVA_HOME?.trim();
  if (configured) {
    const configuredHome = path.basename(configured).toLowerCase() === "bin"
      ? path.dirname(configured)
      : configured;
    const configuredJava = path.join(
      configuredHome,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    );
    if (fs.existsSync(configuredJava)) return configuredHome;
  }

  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    ["java"],
    { encoding: "utf8" },
  );
  const javaPath = lookup.stdout?.split(/\r?\n/).find((value) => value.trim());
  return javaPath ? javaHomeFromPath(javaPath) : null;
}

function findMaestro() {
  const userProfile = process.env.USERPROFILE || process.env.HOME;
  if (userProfile) {
    const localBinary = path.join(
      userProfile,
      ".maestro",
      "maestro",
      "bin",
      process.platform === "win32" ? "maestro.bat" : "maestro",
    );
    if (fs.existsSync(localBinary)) return localBinary;
  }
  return "maestro";
}

const env = { ...process.env };
const javaHome = findJavaHome();
if (javaHome) env.JAVA_HOME = javaHome;

const result = spawnSync(findMaestro(), process.argv.slice(2), {
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
