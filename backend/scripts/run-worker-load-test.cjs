const { spawnSync } = require("node:child_process");

const result = spawnSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "--test-name-pattern=1000-event", "src/tests/workerOutbox.test.ts"],
  {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
