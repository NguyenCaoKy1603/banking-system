const { readdirSync, readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

const directory = path.resolve(process.argv[2] ?? path.join(__dirname, "../database"));
const files = readdirSync(directory)
  .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
const hash = createHash("sha256");
for (const fileName of files) {
  hash.update(`${fileName}\0`);
  hash.update(readFileSync(path.join(directory, fileName)));
  hash.update("\0");
}
const first = files[0]?.replace(/\.sql$/i, "") ?? null;
const last = files.at(-1)?.replace(/\.sql$/i, "") ?? null;
process.stdout.write(JSON.stringify({
  directory,
  files,
  firstMigration: first,
  lastMigration: last,
  schemaVersion: last?.match(/^(\d+)_/)?.[1]?.padStart(3, "0") ?? "unknown",
  migrationSetDigest: hash.digest("hex"),
}, null, 2));
