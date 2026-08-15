import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply the draft PostgreSQL migration.");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(scriptDirectory, "../database/001_banking_mvp.sql");
const migration = await readFile(migrationPath, "utf8");
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query("BEGIN");
  await pool.query(migration);
  await pool.query("COMMIT");
  console.log("PostgreSQL draft migration applied successfully.");
} catch (error: unknown) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
