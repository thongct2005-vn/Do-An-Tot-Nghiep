-- Additive migration v2: gộp Merchant Report theo ngày Việt Nam (report_merchant_financial_daily),
-- hợp nhất điều phối theo domain (aggregation_rollup_state kèm dirty_guard_until, aggregation_dirty_buckets),
-- và gắn trigger v2 song song (KHÔNG xóa 7 bảng cũ hay trigger cũ).
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.report_merchant_financial_daily (
  bucket_day       date NOT NULL,
  merchant_id      uuid NOT NULL,
  transaction_type text NOT NULL,
  tx_count         bigint NOT NULL DEFAULT 0,
  tx_amount        numeric(22, 0) NOT NULL DEFAULT 0,
  fee_amount       numeric(22, 0) NOT NULL DEFAULT 0,
  fee_tx_count     bigint NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_day, merchant_id, transaction_type)
);

CREATE INDEX IF NOT EXISTS idx_report_fin_daily_day_type
  ON public.report_merchant_financial_daily (bucket_day, transaction_type)
  INCLUDE (tx_count, tx_amount, fee_amount, fee_tx_count);

CREATE INDEX IF NOT EXISTS idx_report_fin_daily_merchant_day
  ON public.report_merchant_financial_daily (merchant_id, bucket_day);

CREATE TABLE IF NOT EXISTS public.aggregation_rollup_state (
  domain             varchar(32) PRIMARY KEY,
  rollup_until       timestamptz NOT NULL DEFAULT '-infinity'::timestamptz,
  dirty_guard_until  timestamptz,
  triggers_paused_at timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_agg_state_domain CHECK (domain IN ('dashboard', 'report_merchant'))
);

ALTER TABLE public.aggregation_rollup_state
  ADD COLUMN IF NOT EXISTS triggers_paused_at timestamptz;

INSERT INTO public.aggregation_rollup_state (domain, rollup_until, dirty_guard_until)
VALUES
  ('dashboard', '-infinity'::timestamptz, NULL),
  ('report_merchant', '-infinity'::timestamptz, NULL)
ON CONFLICT (domain) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.aggregation_dirty_buckets (
  domain     varchar(32) NOT NULL,
  bucket_ts  timestamptz NOT NULL,
  dirty_tx   boolean NOT NULL DEFAULT false,
  dirty_fee  boolean NOT NULL DEFAULT false,
  marked_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (domain, bucket_ts),
  CONSTRAINT chk_agg_dirty_domain CHECK (domain IN ('dashboard', 'report_merchant'))
);

CREATE OR REPLACE FUNCTION public.fn_upsert_agg_dirty_bucket_v2(
  p_domain varchar,
  p_bucket_ts timestamptz,
  p_dirty_tx boolean,
  p_dirty_fee boolean
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_bucket_ts IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.aggregation_dirty_buckets (domain, bucket_ts, dirty_tx, dirty_fee, marked_at)
  VALUES (p_domain, p_bucket_ts, COALESCE(p_dirty_tx, false), COALESCE(p_dirty_fee, false), clock_timestamp())
  ON CONFLICT (domain, bucket_ts) DO UPDATE SET
    dirty_tx  = public.aggregation_dirty_buckets.dirty_tx  OR EXCLUDED.dirty_tx,
    dirty_fee = public.aggregation_dirty_buckets.dirty_fee OR EXCLUDED.dirty_fee,
    marked_at = clock_timestamp();
END;
$$;

-- Trigger v2 cho Dashboard (hạt giờ UTC)
CREATE OR REPLACE FUNCTION public.fn_mark_dashboard_dirty_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_guard_until timestamptz;
  v_old_hour    timestamptz;
  v_new_hour    timestamptz;
BEGIN
  SELECT COALESCE(GREATEST(rollup_until, dirty_guard_until), rollup_until)
  INTO v_guard_until
  FROM public.aggregation_rollup_state
  WHERE domain = 'dashboard';

  IF v_guard_until IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.created_at < v_guard_until THEN
    v_old_hour := date_trunc('hour', OLD.created_at);
    PERFORM public.fn_upsert_agg_dirty_bucket_v2('dashboard', v_old_hour, true, false);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.created_at < v_guard_until THEN
    v_new_hour := date_trunc('hour', NEW.created_at);
    IF v_old_hour IS NULL OR v_new_hour <> v_old_hour THEN
      PERFORM public.fn_upsert_agg_dirty_bucket_v2('dashboard', v_new_hour, true, false);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Trigger v2 cho Merchant Report phía giao dịch (hạt ngày Việt Nam)
CREATE OR REPLACE FUNCTION public.fn_mark_report_tx_dirty_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_guard_until timestamptz;
  v_old_day     timestamptz;
  v_new_day     timestamptz;
  v_tx_id       text;
  v_fee_day     timestamptz;
BEGIN
  SELECT COALESCE(GREATEST(rollup_until, dirty_guard_until), rollup_until)
  INTO v_guard_until
  FROM public.aggregation_rollup_state
  WHERE domain = 'report_merchant';

  IF v_guard_until IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.transaction_type IN ('PAYMENT', 'TRANSFER')
     AND OLD.destination_user_id IS NOT NULL
     AND OLD.created_at < v_guard_until THEN
    v_old_day := DATE_TRUNC('day', OLD.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
    PERFORM public.fn_upsert_agg_dirty_bucket_v2('report_merchant', v_old_day, true, false);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.transaction_type IN ('PAYMENT', 'TRANSFER')
     AND NEW.destination_user_id IS NOT NULL
     AND NEW.created_at < v_guard_until THEN
    v_new_day := DATE_TRUNC('day', NEW.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF v_old_day IS NULL OR v_new_day <> v_old_day THEN
      PERFORM public.fn_upsert_agg_dirty_bucket_v2('report_merchant', v_new_day, true, false);
    END IF;
  END IF;

  -- Nếu giao dịch cũ thay đổi trạng thái/merchant/loại/xóa, cần đánh dấu cả ngày của fee_ledger_entries liên kết (kể cả khác ngày VN)
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_tx_id := OLD.id::text;
    FOR v_fee_day IN
      SELECT DISTINCT (DATE_TRUNC('day', l.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')
      FROM public.fee_ledger_entries l
      WHERE l.transaction_id = v_tx_id
        AND l.fee_type = 'QR_FEE'
        AND l.created_at < v_guard_until
    LOOP
      PERFORM public.fn_upsert_agg_dirty_bucket_v2('report_merchant', v_fee_day, false, true);
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

-- Trigger v2 cho Merchant Report phía sổ cái phí (hạt ngày Việt Nam)
CREATE OR REPLACE FUNCTION public.fn_mark_report_fee_dirty_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_guard_until timestamptz;
  v_old_day     timestamptz;
  v_new_day     timestamptz;
BEGIN
  SELECT COALESCE(GREATEST(rollup_until, dirty_guard_until), rollup_until)
  INTO v_guard_until
  FROM public.aggregation_rollup_state
  WHERE domain = 'report_merchant';

  IF v_guard_until IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND OLD.fee_type = 'QR_FEE'
     AND OLD.created_at < v_guard_until THEN
    v_old_day := DATE_TRUNC('day', OLD.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
    PERFORM public.fn_upsert_agg_dirty_bucket_v2('report_merchant', v_old_day, false, true);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.fee_type = 'QR_FEE'
     AND NEW.created_at < v_guard_until THEN
    v_new_day := DATE_TRUNC('day', NEW.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
    IF v_old_day IS NULL OR v_new_day <> v_old_day THEN
      PERFORM public.fn_upsert_agg_dirty_bucket_v2('report_merchant', v_new_day, false, true);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_dashboard_dirty_v2 ON public.transactions;
CREATE TRIGGER trg_transactions_dashboard_dirty_v2
AFTER INSERT OR DELETE OR UPDATE OF created_at, transaction_type, status, amount
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.fn_mark_dashboard_dirty_v2();

DROP TRIGGER IF EXISTS trg_tx_report_dirty_ins_v2 ON public.transactions;
DROP TRIGGER IF EXISTS trg_tx_report_dirty_upd_v2 ON public.transactions;
DROP TRIGGER IF EXISTS trg_tx_report_dirty_del_v2 ON public.transactions;

CREATE TRIGGER trg_tx_report_dirty_ins_v2
AFTER INSERT ON public.transactions
FOR EACH ROW
WHEN (NEW.transaction_type IN ('PAYMENT', 'TRANSFER') AND NEW.destination_user_id IS NOT NULL)
EXECUTE FUNCTION public.fn_mark_report_tx_dirty_v2();

CREATE TRIGGER trg_tx_report_dirty_upd_v2
AFTER UPDATE OF created_at, transaction_type, status, amount, merchant_fee, fee_rate_snapshot, destination_user_id
ON public.transactions
FOR EACH ROW
WHEN (
  (OLD.transaction_type IN ('PAYMENT', 'TRANSFER') OR NEW.transaction_type IN ('PAYMENT', 'TRANSFER'))
  AND (OLD.destination_user_id IS NOT NULL OR NEW.destination_user_id IS NOT NULL)
  AND (
    OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.transaction_type IS DISTINCT FROM NEW.transaction_type
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.merchant_fee IS DISTINCT FROM NEW.merchant_fee
    OR OLD.fee_rate_snapshot IS DISTINCT FROM NEW.fee_rate_snapshot
    OR OLD.destination_user_id IS DISTINCT FROM NEW.destination_user_id
  )
)
EXECUTE FUNCTION public.fn_mark_report_tx_dirty_v2();

CREATE TRIGGER trg_tx_report_dirty_del_v2
AFTER DELETE ON public.transactions
FOR EACH ROW
WHEN (OLD.transaction_type IN ('PAYMENT', 'TRANSFER') AND OLD.destination_user_id IS NOT NULL)
EXECUTE FUNCTION public.fn_mark_report_tx_dirty_v2();

DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_ins_v2 ON public.fee_ledger_entries;
DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_upd_v2 ON public.fee_ledger_entries;
DROP TRIGGER IF EXISTS trg_fee_ledger_report_dirty_del_v2 ON public.fee_ledger_entries;

CREATE TRIGGER trg_fee_ledger_report_dirty_ins_v2
AFTER INSERT ON public.fee_ledger_entries
FOR EACH ROW
WHEN (NEW.fee_type = 'QR_FEE')
EXECUTE FUNCTION public.fn_mark_report_fee_dirty_v2();

CREATE TRIGGER trg_fee_ledger_report_dirty_upd_v2
AFTER UPDATE OF created_at, fee_type, amount, transaction_id, merchant_user_id
ON public.fee_ledger_entries
FOR EACH ROW
WHEN (
  (OLD.fee_type = 'QR_FEE' OR NEW.fee_type = 'QR_FEE')
  AND (
    OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.fee_type IS DISTINCT FROM NEW.fee_type
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.transaction_id IS DISTINCT FROM NEW.transaction_id
    OR OLD.merchant_user_id IS DISTINCT FROM NEW.merchant_user_id
  )
)
EXECUTE FUNCTION public.fn_mark_report_fee_dirty_v2();

CREATE TRIGGER trg_fee_ledger_report_dirty_del_v2
AFTER DELETE ON public.fee_ledger_entries
FOR EACH ROW
WHEN (OLD.fee_type = 'QR_FEE')
EXECUTE FUNCTION public.fn_mark_report_fee_dirty_v2();

COMMIT;
