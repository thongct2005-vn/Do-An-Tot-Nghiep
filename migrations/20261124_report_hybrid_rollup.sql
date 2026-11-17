-- Additive migration for Reports Unified Hybrid Rollup
-- (report_merchant_fee_hourly, report_merchant_tx_hourly, report_gateway_hourly + dirty-hour triggers).
-- Safe to apply online; rollup_until starts at -infinity until backfilled.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.report_merchant_fee_hourly (
  bucket_hour TIMESTAMPTZ NOT NULL,
  merchant_id UUID NOT NULL,
  transaction_type TEXT NOT NULL,
  fee_amount NUMERIC(22, 0) NOT NULL DEFAULT 0,
  fee_tx_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_hour, merchant_id, transaction_type)
);

CREATE INDEX IF NOT EXISTS idx_report_fee_hourly_bucket_type
  ON public.report_merchant_fee_hourly (bucket_hour, transaction_type)
  INCLUDE (fee_amount, fee_tx_count);

CREATE TABLE IF NOT EXISTS public.report_merchant_tx_hourly (
  bucket_hour TIMESTAMPTZ NOT NULL,
  merchant_id UUID NOT NULL,
  transaction_type TEXT NOT NULL,
  tx_count BIGINT NOT NULL DEFAULT 0,
  tx_amount NUMERIC(22, 0) NOT NULL DEFAULT 0,
  merchant_fee_total NUMERIC(22, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_hour, merchant_id, transaction_type)
);

CREATE INDEX IF NOT EXISTS idx_report_tx_hourly_bucket_type
  ON public.report_merchant_tx_hourly (bucket_hour, transaction_type)
  INCLUDE (tx_count, tx_amount, merchant_fee_total);

CREATE TABLE IF NOT EXISTS public.report_gateway_hourly (
  bucket_hour TIMESTAMPTZ NOT NULL,
  merchant_id UUID NOT NULL,
  has_order_id BOOLEAN NOT NULL,
  total_requests BIGINT NOT NULL DEFAULT 0,
  success_count BIGINT NOT NULL DEFAULT 0,
  pending_count BIGINT NOT NULL DEFAULT 0,
  expired_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  cancelled_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_hour, merchant_id, has_order_id)
);

CREATE INDEX IF NOT EXISTS idx_report_gateway_hourly_order_bucket
  ON public.report_gateway_hourly (bucket_hour, merchant_id)
  INCLUDE (total_requests, success_count, pending_count, expired_count, failed_count, cancelled_count)
  WHERE has_order_id = true;

CREATE TABLE IF NOT EXISTS public.report_rollup_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  rollup_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.report_rollup_state (id, rollup_until)
VALUES (1, '-infinity'::timestamptz)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.report_dirty_hours (
  bucket_hour TIMESTAMPTZ PRIMARY KEY,
  dirty_fee BOOLEAN NOT NULL DEFAULT false,
  dirty_tx BOOLEAN NOT NULL DEFAULT false,
  dirty_gateway BOOLEAN NOT NULL DEFAULT false,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.fn_upsert_report_dirty_hour(
  p_hour TIMESTAMPTZ,
  p_fee BOOLEAN,
  p_tx BOOLEAN,
  p_gateway BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_hour IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.report_dirty_hours (bucket_hour, dirty_fee, dirty_tx, dirty_gateway, marked_at)
  VALUES (p_hour, p_fee, p_tx, p_gateway, clock_timestamp())
  ON CONFLICT (bucket_hour) DO UPDATE SET
    dirty_fee = public.report_dirty_hours.dirty_fee OR EXCLUDED.dirty_fee,
    dirty_tx = public.report_dirty_hours.dirty_tx OR EXCLUDED.dirty_tx,
    dirty_gateway = public.report_dirty_hours.dirty_gateway OR EXCLUDED.dirty_gateway,
    marked_at = clock_timestamp();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_report_fee_dirty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rollup_until TIMESTAMPTZ;
  v_old_hour TIMESTAMPTZ;
  v_new_hour TIMESTAMPTZ;
BEGIN
  SELECT rollup_until INTO v_rollup_until
  FROM public.report_rollup_state
  WHERE id = 1;

  IF v_rollup_until IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.created_at < v_rollup_until THEN
    v_old_hour := date_trunc('hour', OLD.created_at);
    PERFORM public.fn_upsert_report_dirty_hour(v_old_hour, true, false, false);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.created_at < v_rollup_until THEN
    v_new_hour := date_trunc('hour', NEW.created_at);
    IF v_old_hour IS NULL OR v_new_hour <> v_old_hour THEN
      PERFORM public.fn_upsert_report_dirty_hour(v_new_hour, true, false, false);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_report_tx_dirty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rollup_until TIMESTAMPTZ;
  v_old_hour TIMESTAMPTZ;
  v_new_hour TIMESTAMPTZ;
  v_tx_id TEXT;
  v_fee_hour TIMESTAMPTZ;
BEGIN
  SELECT rollup_until INTO v_rollup_until
  FROM public.report_rollup_state
  WHERE id = 1;

  IF v_rollup_until IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.created_at < v_rollup_until THEN
    v_old_hour := date_trunc('hour', OLD.created_at);
    PERFORM public.fn_upsert_report_dirty_hour(v_old_hour, false, true, false);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.created_at < v_rollup_until THEN
    v_new_hour := date_trunc('hour', NEW.created_at);
    IF v_old_hour IS NULL OR v_new_hour <> v_old_hour THEN
      PERFORM public.fn_upsert_report_dirty_hour(v_new_hour, false, true, false);
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_tx_id := OLD.id::text;
    FOR v_fee_hour IN
      SELECT DISTINCT date_trunc('hour', l.created_at)
      FROM public.fee_ledger_entries l
      WHERE l.transaction_id = v_tx_id
        AND l.fee_type = 'QR_FEE'
        AND l.created_at < v_rollup_until
    LOOP
      PERFORM public.fn_upsert_report_dirty_hour(v_fee_hour, true, false, false);
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_report_gateway_dirty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rollup_until TIMESTAMPTZ;
  v_old_hour TIMESTAMPTZ;
  v_new_hour TIMESTAMPTZ;
BEGIN
  SELECT rollup_until INTO v_rollup_until
  FROM public.report_rollup_state
  WHERE id = 1;

  IF v_rollup_until IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.created_at IS NOT NULL AND OLD.created_at < v_rollup_until THEN
    v_old_hour := date_trunc('hour', OLD.created_at);
    PERFORM public.fn_upsert_report_dirty_hour(v_old_hour, false, false, true);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.created_at IS NOT NULL AND NEW.created_at < v_rollup_until THEN
    v_new_hour := date_trunc('hour', NEW.created_at);
    IF v_old_hour IS NULL OR v_new_hour <> v_old_hour THEN
      PERFORM public.fn_upsert_report_dirty_hour(v_new_hour, false, false, true);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_ins ON public.fee_ledger_entries;
DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_upd ON public.fee_ledger_entries;
DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_del ON public.fee_ledger_entries;

CREATE TRIGGER trg_fee_ledger_report_dirty_ins
AFTER INSERT ON public.fee_ledger_entries
FOR EACH ROW
WHEN (NEW.fee_type = 'QR_FEE')
EXECUTE FUNCTION public.fn_mark_report_fee_dirty();

CREATE TRIGGER trg_fee_ledger_report_dirty_upd
AFTER UPDATE OF created_at, fee_type, amount, transaction_id ON public.fee_ledger_entries
FOR EACH ROW
WHEN (
  (OLD.fee_type = 'QR_FEE' OR NEW.fee_type = 'QR_FEE')
  AND (
    OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.fee_type IS DISTINCT FROM NEW.fee_type
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.transaction_id IS DISTINCT FROM NEW.transaction_id
  )
)
EXECUTE FUNCTION public.fn_mark_report_fee_dirty();

CREATE TRIGGER trg_fee_ledger_report_dirty_del
AFTER DELETE ON public.fee_ledger_entries
FOR EACH ROW
WHEN (OLD.fee_type = 'QR_FEE')
EXECUTE FUNCTION public.fn_mark_report_fee_dirty();

DROP TRIGGER IF EXISTS trg_tx_report_dirty_ins ON public.transactions;
DROP TRIGGER IF EXISTS trg_tx_report_dirty_upd ON public.transactions;
DROP TRIGGER IF EXISTS trg_tx_report_dirty_del ON public.transactions;

CREATE TRIGGER trg_tx_report_dirty_ins
AFTER INSERT ON public.transactions
FOR EACH ROW
WHEN (NEW.transaction_type IN ('PAYMENT', 'TRANSFER') AND NEW.destination_user_id IS NOT NULL)
EXECUTE FUNCTION public.fn_mark_report_tx_dirty();

CREATE TRIGGER trg_tx_report_dirty_upd
AFTER UPDATE OF created_at, transaction_type, status, amount, merchant_fee, destination_user_id ON public.transactions
FOR EACH ROW
WHEN (
  (OLD.transaction_type IN ('PAYMENT', 'TRANSFER') OR NEW.transaction_type IN ('PAYMENT', 'TRANSFER'))
  AND (
    OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.transaction_type IS DISTINCT FROM NEW.transaction_type
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.merchant_fee IS DISTINCT FROM NEW.merchant_fee
    OR OLD.destination_user_id IS DISTINCT FROM NEW.destination_user_id
  )
)
EXECUTE FUNCTION public.fn_mark_report_tx_dirty();

CREATE TRIGGER trg_tx_report_dirty_del
AFTER DELETE ON public.transactions
FOR EACH ROW
WHEN (OLD.transaction_type IN ('PAYMENT', 'TRANSFER') AND OLD.destination_user_id IS NOT NULL)
EXECUTE FUNCTION public.fn_mark_report_tx_dirty();

DROP TRIGGER IF EXISTS trg_pr_report_dirty_ins ON public.payment_requests;
DROP TRIGGER IF EXISTS trg_pr_report_dirty_upd ON public.payment_requests;
DROP TRIGGER IF EXISTS trg_pr_report_dirty_del ON public.payment_requests;

CREATE TRIGGER trg_pr_report_dirty_ins
AFTER INSERT ON public.payment_requests
FOR EACH ROW
WHEN (NEW.created_at IS NOT NULL)
EXECUTE FUNCTION public.fn_mark_report_gateway_dirty();

CREATE TRIGGER trg_pr_report_dirty_upd
AFTER UPDATE OF created_at, destination_user_id, order_id, status ON public.payment_requests
FOR EACH ROW
WHEN (
  (OLD.created_at IS NOT NULL OR NEW.created_at IS NOT NULL)
  AND (
    OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.destination_user_id IS DISTINCT FROM NEW.destination_user_id
    OR OLD.order_id IS DISTINCT FROM NEW.order_id
    OR OLD.status IS DISTINCT FROM NEW.status
  )
)
EXECUTE FUNCTION public.fn_mark_report_gateway_dirty();

CREATE TRIGGER trg_pr_report_dirty_del
AFTER DELETE ON public.payment_requests
FOR EACH ROW
WHEN (OLD.created_at IS NOT NULL)
EXECUTE FUNCTION public.fn_mark_report_gateway_dirty();

COMMIT;
