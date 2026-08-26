const { spawn } = require("node:child_process");
const path = require("node:path");
const { arg, repoRoot } = require("./backup-common.cjs");

const intervalSeconds = Number(arg("interval-seconds", process.env.BACKUP_INTERVAL_SECONDS ?? "86400"));
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
  console.error("interval-seconds must be an integer of at least 60 seconds.");
  process.exitCode = 2;
} else {
  let running = false;
  let stopped = false;
  const runOnce = () => {
    if (running || stopped) return;
    running = true;
    const child = spawn(process.execPath, [path.join(repoRoot, "backend", "scripts", "backup-create.cjs")], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("close", (code) => {
      running = false;
      if (code !== 0) console.error(JSON.stringify({ event: "backup_scheduler_run_failed", code }));
    });
  };
  runOnce();
  const timer = setInterval(runOnce, intervalSeconds * 1000);
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    process.exitCode = 0;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
