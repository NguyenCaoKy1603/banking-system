import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
const bankingEnvironment = (process.env.BANKING_ENV ?? "development").trim().toLowerCase();
const confirmation = process.env.E2E_RESET_CONFIRM?.trim();

const resetConfirmation = "RESET_REFERENCE_SANDBOX";
const allowedLocalHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const applicationTables = [
  "reference_runtime_records",
  "credit_payments",
  "credit_payment_quotes",
  "credit_statement_items",
  "credit_statements",
  "credit_transactions",
  "credit_cards",
  "credit_accounts",
  "savings_deposits",
  "savings_openings",
  "savings_quotes",
  "savings_products",
  "fraud_reports",
  "outbox_events",
  "audit_events",
  "ledger_entries",
  "ledger_journals",
  "account_transactions",
  "transfers",
  "transfer_quotes",
  "beneficiaries",
  "payment_accounts",
  "auth_sessions",
  "customer_devices",
  "customers",
  "notifications",
  "reference_state_snapshots",
  "control_policy",
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function validateResetTarget(): URL {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to reset the reference sandbox.");
  }
  if (bankingEnvironment === "production") {
    throw new Error("Refusing to reset a production environment.");
  }
  if (confirmation !== resetConfirmation) {
    throw new Error(
      `Refusing to reset data. Set E2E_RESET_CONFIRM=${resetConfirmation} explicitly for a disposable local sandbox.`,
    );
  }

  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("Only PostgreSQL URLs are supported by the sandbox reset command.");
  }
  if (!allowedLocalHosts.has(target.hostname)) {
    throw new Error(
      "Refusing to reset a remote database. Use a local PostgreSQL database for the reference sandbox.",
    );
  }

  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/(?:test|sandbox|e2e)$/i.test(databaseName)) {
    throw new Error(
      "Refusing to reset a database whose name does not end in test, sandbox or e2e.",
    );
  }

  return target;
}

const target = validateResetTarget();
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query("BEGIN");
  await pool.query(
    `TRUNCATE TABLE ${applicationTables.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await pool.query("COMMIT");

  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  console.log(`Reference sandbox reset completed for local database ${databaseName}.`);
  console.log("Schema migrations were preserved; run npm run seed:e2e to create deterministic demo data.");
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}
