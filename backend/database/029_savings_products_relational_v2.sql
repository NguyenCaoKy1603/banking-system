-- Seed the stable reference savings catalogue required by the relational-v2
-- savings boundary.  Product codes are the public contract; UUIDs are stable
-- database identities and are never exposed to the client.
INSERT INTO savings_products
  (id, product_code, name, term_months, annual_rate_basis_points, currency,
   min_amount_minor, max_amount_minor, status, terms_version, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'savings-vnd-1m', 'Tiết kiệm 1 tháng', 1, 300, 'VND', 1000000, 500000000, 'ACTIVE', 'sandbox-2026-08-v1', NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000002', 'savings-vnd-3m', 'Tiết kiệm 3 tháng', 3, 350, 'VND', 1000000, 500000000, 'ACTIVE', 'sandbox-2026-08-v1', NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000003', 'savings-vnd-6m', 'Tiết kiệm 6 tháng', 6, 450, 'VND', 1000000, 500000000, 'ACTIVE', 'sandbox-2026-08-v1', NOW(), NOW()),
  ('00000000-0000-4000-8000-000000000004', 'savings-vnd-12m', 'Tiết kiệm 12 tháng', 12, 500, 'VND', 1000000, 500000000, 'ACTIVE', 'sandbox-2026-08-v1', NOW(), NOW())
ON CONFLICT (product_code) DO UPDATE SET
  name = EXCLUDED.name,
  term_months = EXCLUDED.term_months,
  annual_rate_basis_points = EXCLUDED.annual_rate_basis_points,
  min_amount_minor = EXCLUDED.min_amount_minor,
  max_amount_minor = EXCLUDED.max_amount_minor,
  status = EXCLUDED.status,
  terms_version = EXCLUDED.terms_version,
  updated_at = NOW();
