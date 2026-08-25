const crypto = require("node:crypto");
const { Pool } = require("pg");
const { arg } = require("./backup-common.cjs");

async function main() {
  const environment = (arg("environment", process.env.BANKING_ENV || "preview") || "preview").toLowerCase();
  if (!["development", "test", "preview"].includes(environment)) throw new Error("Local DR marker writer only accepts development, test or preview.");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for a DR recovery marker.");
  const releaseId = String(arg("release-id", process.env.RELEASE_ID || "local-preview"));
  const committedAt = new Date();
  const markerHash = crypto.createHash("sha256").update(`${environment}\0${releaseId}\0${committedAt.toISOString()}\0${crypto.randomUUID()}`).digest("hex");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("INSERT INTO dr_recovery_markers (id, committed_at, marker_hash, source_release_id) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), committedAt.toISOString(), markerHash, releaseId]);
    process.stdout.write(`${JSON.stringify({ status: "MARKER_COMMITTED", environment, committedAt: committedAt.toISOString(), sourceReleaseId: releaseId })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
