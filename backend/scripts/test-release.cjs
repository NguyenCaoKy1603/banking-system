const { spawnSync } = require("node:child_process");
const { URL } = require("node:url");

const adminUrl = process.env.DATABASE_TEST_ADMIN_URL?.trim();
if (!adminUrl) {
  throw new Error("DATABASE_TEST_ADMIN_URL is required; release-quality rehearsal is disposable-only and never uses preview.");
}
const parsed = new URL(adminUrl);
if (!["postgres", "template1"].includes(parsed.pathname.replace(/^\//, "")) || /banking_preview/i.test(parsed.pathname)) {
  throw new Error("DATABASE_TEST_ADMIN_URL must target postgres/template1, never banking_preview.");
}

const commands = [
  ["test", "pure/unit aggregate (DB suites intentionally skipped without a target URL)"],
  ["test:critical", "HTTP critical contract"],
  ["test:database:guard", "disposable database negative/positive guard"],
  ["test:database", "database foundation disposable"],
  ["test:relational", "legacy relational adapter regression (disposable only)"],
  ["test:mfa:persistence", "persistent MFA disposable"],
  ["test:registration:persistence", "registration/provider boundary disposable"],
  ["test:savings:persistence", "Savings opening disposable"],
  ["test:credit:persistence", "Credit command disposable"],
  ["test:remaining:persistence", "remaining customer routes disposable"],
  ["test:lifecycle:persistence", "Savings/Credit scheduled lifecycle + worker concurrency disposable"],
  ["test:lifecycle:scheduler", "two-process lifecycle scheduler disposable rehearsal"],
  ["test:runtime-email", "runtime HTTP email provider timeout/retry/fail-closed contract"],
  ["test:integrated:disposable", "API + SMTP email + two workers + two lifecycle schedulers disposable rehearsal"],
  ["test:admin:database", "Admin PostgreSQL disposable"],
  ["test:persistence", "legacy/regression persistence disposable"],
  ["test:worker", "worker lease/retry/dead-letter/restart/load disposable"],
];

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const baseEnv = {
  ...process.env,
};
const summaries = [];

for (const [script, description] of commands) {
  const env = { ...baseEnv };
  env.BANKING_PERSISTENCE_MODE = [
    "test",
    "test:critical",
    "test:database:guard",
    "test:relational",
    "test:admin:database",
    "test:persistence",
    "test:worker",
  ].includes(script)
    ? "legacy-state"
    : "relational-v2";
  if (script === "test") {
    delete env.DATABASE_TEST_ADMIN_URL;
    delete env.DATABASE_URL;
    delete env.RELATIONAL_DATABASE_URL;
    delete env.WORKER_DATABASE_URL;
  }
  if (script === "test:worker") {
    env.WORKER_ENABLED = "1";
    env.WORKER_CUTOVER_CONFIRMED = "1";
    env.WORKER_PERSISTENCE_MODE = "relational-v2";
  }
  console.log(`\n[release-quality] ${script} — ${description}`);
  const result = spawnSync(npmCommand, ["run", script], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === "win32",
    stdio: ["inherit", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  const tests = output.match(/ℹ tests (\d+)/)?.[1] ?? "-";
  const passed = output.match(/ℹ pass (\d+)/)?.[1] ?? "-";
  const failed = output.match(/ℹ fail (\d+)/)?.[1] ?? (result.status === 0 ? "0" : "unknown");
  const skipped = output.match(/ℹ skipped (\d+)/)?.[1] ?? "-";
  summaries.push({ script, description, status: result.status === 0 ? "PASS" : "FAIL", tests, passed, failed, skipped });
  if (result.status !== 0) {
    console.error(`\n[release-quality] stopped at ${script}; no promotion decision is made.`);
    break;
  }
}

console.log("\n[release-quality] summary");
console.table(summaries);
console.log("SKIP POLICY:");
console.log("- Aggregate npm test does not receive a database URL, so PostgreSQL tests skip intentionally to protect banking_preview.");
console.log("- Every skipped PostgreSQL group must have a PASS row in the disposable commands above; a missing/failed row blocks this gate.");
console.log("- This rehearsal does not change .env.compose, start the preview worker, or create staging/cloud evidence.");

if (summaries.some((item) => item.status !== "PASS") || summaries.length !== commands.length) process.exitCode = 1;
