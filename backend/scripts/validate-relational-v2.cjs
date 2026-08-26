const { Pool } = require("pg");
const { resolvePostgresSsl } = require("./postgres-ssl.cjs");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for relational-v2 validation.");

const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: resolvePostgresSsl() });

async function main() {
  try {
    const requiredMigrations = [
      "006_relational_v2_foundation",
      "007_identity_runtime_normalization",
      "008_transfer_relational_v2",
      "009_savings_relational_v2",
      "010_credit_relational_v2",
      "011_registration_recovery",
      "029_savings_products_relational_v2",
      "030_credit_relational_v2_cutover",
      "031_remaining_relational_v2",
    ];
    const migrations = await pool.query(
      `SELECT migration_key, checksum
       FROM reference_schema_migrations
       WHERE migration_key = ANY($1::text[])
       ORDER BY migration_key`,
      [requiredMigrations],
    );
    if (migrations.rowCount !== requiredMigrations.length || migrations.rows.some((row) => !row.checksum)) {
      throw new Error("Required relational-v2 migrations 006-011 and 029-031 are not all applied with checksums.");
    }

    const invariants = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM payment_accounts WHERE account_number IS NULL) AS null_account_numbers,
        (SELECT COUNT(*) FROM (
          SELECT account_number FROM payment_accounts GROUP BY account_number HAVING COUNT(*) > 1
        ) duplicates) AS duplicate_account_numbers,
        (SELECT COUNT(*) FROM transfer_quotes q LEFT JOIN transfers t ON t.id = q.consumed_transfer_id
          WHERE q.consumed_transfer_id IS NOT NULL AND t.id IS NULL) AS orphan_consumed_quotes,
        (SELECT COUNT(*) FROM transfers t LEFT JOIN payment_accounts a ON a.id = t.destination_account_id
          WHERE t.destination_account_id IS NOT NULL AND a.id IS NULL) AS orphan_transfer_destinations,
        (SELECT COUNT(*) FROM savings_deposits d LEFT JOIN savings_openings o ON o.id = d.opening_id
          WHERE d.opening_id IS NOT NULL AND o.id IS NULL) AS orphan_savings_openings,
        (SELECT COUNT(*) FROM credit_payments p LEFT JOIN credit_payment_quotes q ON q.id = p.quote_id
          WHERE q.id IS NULL) AS orphan_credit_quotes,
        (SELECT COUNT(*) FROM fraud_report_idempotency i LEFT JOIN fraud_reports r ON r.id = i.report_id
          WHERE i.report_id IS NOT NULL AND r.id IS NULL) AS orphan_fraud_idempotency,
        (SELECT COUNT(*) FROM recipient_lookups l LEFT JOIN payment_accounts a ON a.id = l.destination_account_id
          WHERE a.id IS NULL) AS orphan_recipient_lookups
    `);
    const row = invariants.rows[0];
    for (const [key, value] of Object.entries(row)) {
      if (Number(value) !== 0) throw new Error(`Relational-v2 invariant failed: ${key}=${value}`);
    }

    const collections = await pool.query(
      `SELECT collection, COUNT(*)::int AS count
       FROM reference_runtime_records
       GROUP BY collection
       ORDER BY collection`,
    );
    const normalized = await pool.query(`
      SELECT 'command_idempotency' AS table_name, COUNT(*)::int AS count FROM command_idempotency
      UNION ALL SELECT 'refresh_session_records', COUNT(*)::int FROM refresh_session_records
      UNION ALL SELECT 'auth_challenges', COUNT(*)::int FROM auth_challenges
      UNION ALL SELECT 'pending_registrations', COUNT(*)::int FROM pending_registrations
      UNION ALL SELECT 'savings_idempotency', COUNT(*)::int FROM savings_idempotency
      UNION ALL SELECT 'savings_maturity_operations', COUNT(*)::int FROM savings_maturity_operations
      UNION ALL SELECT 'credit_idempotency', COUNT(*)::int FROM credit_idempotency
      UNION ALL SELECT 'registration_completions', COUNT(*)::int FROM registration_completions
      ORDER BY table_name
    `);
    console.log(JSON.stringify({
      status: "passed",
      migrations: migrations.rows,
      invariants: row,
      legacyRuntimeCollections: collections.rows,
      normalizedTables: normalized.rows,
      note: "reference_runtime_records and withState remain migration/regression-only; relational-v2 HTTP must not call the legacy writer",
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
