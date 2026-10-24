-- P0 business-safety follow-up.  Migration 033 bootstraps the singleton
-- policy; this migration adds customer entitlements and a durable blocked
-- window for password login throttling.  It is additive and forward-only.

ALTER TABLE rate_limit_buckets
  ADD COLUMN IF NOT EXISTS blocked_until timestamptz;

CREATE INDEX IF NOT EXISTS rate_limit_buckets_blocked_idx
  ON rate_limit_buckets (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_feature_entitlements (
  customer_id uuid NOT NULL REFERENCES customers (id),
  feature_code text NOT NULL CHECK (feature_code IN ('TRANSFERS', 'SAVINGS', 'CREDIT')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, feature_code)
);

CREATE INDEX IF NOT EXISTS customer_feature_entitlements_enabled_idx
  ON customer_feature_entitlements (feature_code, customer_id)
  WHERE enabled = true;

-- Existing synthetic customers retain the reference sandbox's previously
-- available capabilities. New customers are seeded by registrationService.
INSERT INTO customer_feature_entitlements (customer_id, feature_code)
SELECT c.id, feature_code
FROM customers c
CROSS JOIN (VALUES ('TRANSFERS'), ('SAVINGS'), ('CREDIT')) AS features(feature_code)
ON CONFLICT (customer_id, feature_code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_customer_feature_entitlements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO customer_feature_entitlements (customer_id, feature_code)
  VALUES (NEW.id, 'TRANSFERS'), (NEW.id, 'SAVINGS'), (NEW.id, 'CREDIT')
  ON CONFLICT (customer_id, feature_code) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_seed_feature_entitlements ON customers;
CREATE TRIGGER customers_seed_feature_entitlements
AFTER INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION seed_customer_feature_entitlements();
