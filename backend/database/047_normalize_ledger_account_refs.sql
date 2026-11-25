-- 047_normalize_ledger_account_refs.sql
-- Forward-only migration to normalize bare payment-account UUIDs in ledger_entries.account_ref
-- to the canonical 'payment-account:<uuid>' format used across transfer, savings, credit, and admin domains.

UPDATE ledger_entries le
SET account_ref = 'payment-account:' || lower(le.account_ref)
WHERE le.account_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (
    EXISTS (
      SELECT 1
      FROM payment_accounts pa
      WHERE pa.id::text = lower(le.account_ref)
    )
    OR NOT (le.account_ref LIKE '%:%')
  );
