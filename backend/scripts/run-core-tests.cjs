const path = require("node:path");
const { readdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const backendRoot = path.resolve(__dirname, "..");
const testFiles = readdirSync(path.join(backendRoot, "src", "tests"))
  .filter((file) => file.endsWith(".test.ts") && !file.includes("workerOutbox"))
  .sort()
  .map((file) => path.join("src", "tests", file));
const tsxCli = path.join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs");
const result = spawnSync(process.execPath, [tsxCli, "--test", "--test-concurrency=1", ...testFiles], {
  cwd: backendRoot,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
