const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { migrationSetDigest } = require("./migration-content.cjs");

const directory = path.resolve(process.argv[2] ?? path.join(__dirname, "../database"));
const files = readdirSync(directory)
  .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
const entries = [];
for (const fileName of files) {
  entries.push({ fileName, sql: readFileSync(path.join(directory, fileName), "utf8") });
}
const first = files[0]?.replace(/\.sql$/i, "") ?? null;
const last = files.at(-1)?.replace(/\.sql$/i, "") ?? null;
process.stdout.write(JSON.stringify({
  directory,
  files,
  firstMigration: first,
  lastMigration: last,
  schemaVersion: last?.match(/^(\d+)_/)?.[1]?.padStart(3, "0") ?? "unknown",
  migrationSetDigest: migrationSetDigest(entries),
}, null, 2));
