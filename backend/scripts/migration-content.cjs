const { createHash } = require("node:crypto");

// Migration identity is based on SQL text, not checkout newline style.
function canonicalMigrationSql(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function migrationChecksum(value) {
  return createHash("sha256").update(canonicalMigrationSql(value), "utf8").digest("hex");
}

function rawMigrationChecksum(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function migrationSetDigest(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(`${entry.fileName}\0${canonicalMigrationSql(entry.sql)}\0`, "utf8");
  return hash.digest("hex");
}

module.exports = { canonicalMigrationSql, migrationChecksum, rawMigrationChecksum, migrationSetDigest };
