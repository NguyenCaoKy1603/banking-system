-- Credit lifecycle correctness. Activation creates an account/card only; the
-- first statement is emitted by the scheduled close command at cycle end.

ALTER TABLE credit_accounts
  ADD COLUMN IF NOT EXISTS current_cycle_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS cycle_backfill_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cycle_backfill_review_reason text;

-- A legacy account without a trustworthy statement boundary must remain
-- operable, but the one-month fallback is evidence for manual review rather
-- than an asserted historical fact.  Mark it before populating the cursor so
-- the migration never silently classifies ambiguous history as a valid cycle.
UPDATE credit_accounts ca
SET cycle_backfill_review_required = true,
    cycle_backfill_review_reason = CASE
      WHEN EXISTS (
        SELECT 1 FROM credit_statements cs
         WHERE cs.credit_account_id = ca.id
      ) THEN 'AMBIGUOUS_LEGACY_STATEMENT'
      ELSE 'MISSING_LEGACY_CYCLE_EVIDENCE'
    END
WHERE ca.current_cycle_start_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM credit_statements cs
     WHERE cs.credit_account_id = ca.id
       AND (
         cs.opening_balance_minor <> 0 OR cs.purchase_total_minor <> 0
         OR cs.refund_total_minor <> 0 OR cs.fee_total_minor <> 0
         OR cs.interest_total_minor <> 0 OR cs.closing_balance_minor <> 0
         OR cs.remaining_amount_due_minor <> 0 OR cs.minimum_payment_due_minor <> 0
         OR cs.minimum_payment_remaining_minor <> 0 OR cs.paid_amount_minor <> 0
         OR EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.statement_id = cs.id)
         OR EXISTS (SELECT 1 FROM credit_payments cp WHERE cp.statement_id = cs.id)
       )
  )
  AND NOT EXISTS (
    SELECT 1 FROM credit_statements cs
     WHERE cs.credit_account_id = ca.id
       AND cs.opening_balance_minor = 0 AND cs.purchase_total_minor = 0
       AND cs.refund_total_minor = 0 AND cs.fee_total_minor = 0
       AND cs.interest_total_minor = 0 AND cs.closing_balance_minor = 0
       AND cs.remaining_amount_due_minor = 0 AND cs.minimum_payment_due_minor = 0
       AND cs.minimum_payment_remaining_minor = 0 AND cs.paid_amount_minor = 0
       AND NOT EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.statement_id = cs.id)
       AND NOT EXISTS (SELECT 1 FROM credit_payments cp WHERE cp.statement_id = cs.id)
       AND cs.issued_at = cs.cycle_start_at
       AND cs.cycle_start_at < cs.cycle_end_at
  );

-- Older activation code emitted a zero-valued statement at activation.  Do
-- not delete or rewrite that history.  When it is the only evidence, use its
-- cycle_start as the account cursor; only a statement with a payment,
-- transaction or non-zero aggregate is allowed to advance the cursor to its
-- cycle_end.  The equality issued_at=cycle_start_at plus the strict boundary
-- keeps this repair narrow and replay-safe.
UPDATE credit_accounts ca
SET current_cycle_start_at = COALESCE(
  (
    SELECT MAX(cs.cycle_end_at)
      FROM credit_statements cs
     WHERE cs.credit_account_id = ca.id
       AND (
         cs.opening_balance_minor <> 0 OR cs.purchase_total_minor <> 0
         OR cs.refund_total_minor <> 0 OR cs.fee_total_minor <> 0
         OR cs.interest_total_minor <> 0 OR cs.closing_balance_minor <> 0
         OR cs.remaining_amount_due_minor <> 0 OR cs.minimum_payment_due_minor <> 0
         OR cs.minimum_payment_remaining_minor <> 0 OR cs.paid_amount_minor <> 0
         OR EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.statement_id = cs.id)
         OR EXISTS (SELECT 1 FROM credit_payments cp WHERE cp.statement_id = cs.id)
       )
  ),
  (
    SELECT MAX(cs.cycle_start_at)
      FROM credit_statements cs
     WHERE cs.credit_account_id = ca.id
       AND cs.opening_balance_minor = 0 AND cs.purchase_total_minor = 0
       AND cs.refund_total_minor = 0 AND cs.fee_total_minor = 0
       AND cs.interest_total_minor = 0 AND cs.closing_balance_minor = 0
       AND cs.remaining_amount_due_minor = 0 AND cs.minimum_payment_due_minor = 0
       AND cs.minimum_payment_remaining_minor = 0 AND cs.paid_amount_minor = 0
       AND NOT EXISTS (SELECT 1 FROM credit_transactions ct WHERE ct.statement_id = cs.id)
       AND NOT EXISTS (SELECT 1 FROM credit_payments cp WHERE cp.statement_id = cs.id)
       AND cs.issued_at = cs.cycle_start_at
       AND cs.cycle_start_at < cs.cycle_end_at
  ),
  ca.next_statement_at - INTERVAL '1 month'
)
WHERE current_cycle_start_at IS NULL;

-- Even an evidence-bearing legacy statement is unsafe as the next cursor when
-- it overlaps or reaches the account's scheduled close. Keep the row for
-- investigation and let the scheduler fail closed on start >= end.
UPDATE credit_accounts
SET cycle_backfill_review_required = true,
    cycle_backfill_review_reason = 'INVALID_LEGACY_CYCLE_BOUNDARY'
WHERE current_cycle_start_at >= next_statement_at;

ALTER TABLE credit_accounts
  ALTER COLUMN current_cycle_start_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS credit_accounts_lifecycle_due_idx
  ON credit_accounts (next_statement_at, id)
  WHERE status = 'ACTIVE';
