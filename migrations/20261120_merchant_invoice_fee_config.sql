-- Apply only with MERCHANT_INVOICE_BOUNDARY_V1 code deployed and snapshot columns available.
-- Export the previous config before applying; do not reuse historical fee migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='payment_requests' AND column_name='merchant_fee_rule_snapshot') THEN
    RAISE EXCEPTION 'Apply payment request fee snapshot migration first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM system_configs WHERE key='MERCHANT_FEE_CONFIG') THEN
    RAISE EXCEPTION 'Existing MERCHANT_FEE_CONFIG required';
  END IF;
END
$migration$;
UPDATE system_configs
SET value = value || '{"rate_bps":150,"min_fee":200,"max_fee":null,"free_threshold_amount":0,"tiers":[{"from_amount":0,"rate_bps":150},{"from_amount":200001,"rate_bps":120},{"from_amount":1000001,"rate_bps":100}]}'::jsonb,
    updated_at = NOW()
WHERE key = 'MERCHANT_FEE_CONFIG';
COMMIT;
